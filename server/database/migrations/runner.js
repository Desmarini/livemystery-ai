import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../../../database/migrations/', import.meta.url));
const MIGRATION_FILE_PATTERN = /^(?<version>\d{3,})_(?<name>[a-z0-9][a-z0-9_-]*)\.sql$/;
const MIGRATION_LOCK_NAME = 'livemystery:schema-migrations';

// This is intentionally also present in 002_schema_migrations.sql. The runner
// must create the ledger before it can determine whether 001_initial.sql ran.
const LEDGER_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (version ~ '^[0-9]{3,}_[a-z0-9][a-z0-9_-]*$'),
    CHECK (checksum ~ '^[0-9a-f]{64}$')
  )`;

function quoteSqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function assertMigrationStatementIsTransactional(statement, filename) {
  if (/\bCREATE\s+INDEX\s+CONCURRENTLY\b/i.test(statement)) {
    throw new Error(`${filename} uses CREATE INDEX CONCURRENTLY, which cannot run in the migration transaction.`);
  }
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(statement)) {
    throw new Error(`${filename} contains transaction control; the runner owns the transaction boundary.`);
  }
  if (/\bSET\s+(?:LOCAL\s+)?standard_conforming_strings\b/i.test(statement)) {
    throw new Error(`${filename} changes standard_conforming_strings, which the migration SQL parser does not support.`);
  }
  if (/^\s*COPY\b[\s\S]*\bFROM\s+STDIN\b/i.test(statement)) {
    throw new Error(`${filename} uses COPY FROM STDIN, which requires a protocol stream and is not supported by the runner.`);
  }
}

// Split only on semicolons outside SQL strings, comments, and dollar-quoted bodies.
// This keeps PL/pgSQL functions and DO blocks intact without a SQL dependency.
export function splitSqlStatements(sql) {
  const statements = [];
  let start = 0;
  let index = 0;
  let quote = null;
  let escapeString = false;
  let dollarQuote = null;
  let lineComment = false;
  let blockCommentDepth = 0;

  while (index < sql.length) {
    const character = sql[index];
    const next = sql[index + 1];

    if (lineComment) {
      if (character === '\n') lineComment = false;
      index += 1;
      continue;
    }
    if (blockCommentDepth > 0) {
      if (character === '/' && next === '*') {
        blockCommentDepth += 1;
        index += 2;
        continue;
      }
      if (character === '*' && next === '/') {
        blockCommentDepth -= 1;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, index)) {
        index += dollarQuote.length;
        dollarQuote = null;
        continue;
      }
      index += 1;
      continue;
    }
    if (quote) {
      if (escapeString && character === '\\') {
        if (next === undefined) throw new Error('Migration SQL has an unterminated escape string.');
        index += 2;
        continue;
      }
      if (character === quote) {
        if (next === quote) {
          index += 2;
          continue;
        }
        quote = null;
        escapeString = false;
      }
      index += 1;
      continue;
    }
    if (character === '-' && next === '-') {
      lineComment = true;
      index += 2;
      continue;
    }
    if (character === '/' && next === '*') {
      blockCommentDepth = 1;
      index += 2;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      const prefix = sql.slice(Math.max(0, index - 1), index);
      const beforePrefix = sql.slice(Math.max(0, index - 2), index - 1);
      escapeString = character === "'" && /[Ee]/.test(prefix) && !/[A-Za-z0-9_$]/.test(beforePrefix);
      index += 1;
      continue;
    }
    if (character === '$') {
      const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarQuote = match[0];
        index += dollarQuote.length;
        continue;
      }
    }
    if (character === ';') {
      const statement = sql.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
    index += 1;
  }

  if (quote || dollarQuote || blockCommentDepth > 0) throw new Error('Migration SQL has an unterminated string, dollar quote, or block comment.');
  const trailing = sql.slice(start).trim();
  if (trailing) statements.push(trailing);
  return statements;
}

export function orderMigrations(migrations) {
  const ordered = [...migrations].sort((left, right) => {
    const leftVersion = BigInt(left.version.split('_', 1)[0]);
    const rightVersion = BigInt(right.version.split('_', 1)[0]);
    if (leftVersion < rightVersion) return -1;
    if (leftVersion > rightVersion) return 1;
    return left.filename.localeCompare(right.filename);
  });
  const duplicateNumericVersion = ordered.find((migration, index) => index > 0
    && BigInt(migration.version.split('_', 1)[0]) === BigInt(ordered[index - 1].version.split('_', 1)[0]));
  if (duplicateNumericVersion) {
    throw new Error(`Duplicate numeric migration version: ${duplicateNumericVersion.version.split('_', 1)[0]}.`);
  }
  return ordered;
}

export async function readMigrationFiles(migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY) {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const migrations = await Promise.all(entries
    .filter((entry) => entry.isFile() && MIGRATION_FILE_PATTERN.test(entry.name))
    .map(async (entry) => {
      const match = entry.name.match(MIGRATION_FILE_PATTERN);
      const sql = await readFile(`${migrationsDirectory}/${entry.name}`, 'utf8');
      const statements = splitSqlStatements(sql);
      if (statements.length === 0) throw new Error(`${entry.name} has no SQL statements.`);
      statements.forEach((statement) => assertMigrationStatementIsTransactional(statement, entry.name));
      return {
        filename: entry.name,
        version: `${match.groups.version}_${match.groups.name}`,
        checksum: createHash('sha256').update(sql).digest('hex'),
        statements,
      };
    }));

  return orderMigrations(migrations);
}

export function buildApplyMigrationSql({ version, checksum, statements }) {
  const statementArray = statements.map(quoteSqlLiteral).join(',\n      ');
  return `
DO $livemystery_migration$
DECLARE
  existing_checksum TEXT;
  migration_statement TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(${quoteSqlLiteral(MIGRATION_LOCK_NAME)}, 0));
  EXECUTE ${quoteSqlLiteral(LEDGER_TABLE_DDL)};

  SELECT checksum INTO existing_checksum
  FROM schema_migrations
  WHERE version = ${quoteSqlLiteral(version)};

  IF existing_checksum IS NOT NULL THEN
    IF existing_checksum <> ${quoteSqlLiteral(checksum)} THEN
      RAISE EXCEPTION 'Migration checksum mismatch for version %', ${quoteSqlLiteral(version)}
        USING ERRCODE = '22000';
    END IF;
  ELSE
    FOREACH migration_statement IN ARRAY ARRAY[
      ${statementArray}
    ] LOOP
      EXECUTE migration_statement;
    END LOOP;

    INSERT INTO schema_migrations (version, checksum)
    VALUES (${quoteSqlLiteral(version)}, ${quoteSqlLiteral(checksum)});
  END IF;
END;
$livemystery_migration$;`;
}

export function createMigrationRunner({ executor, migrationsDirectory, loadMigrations = readMigrationFiles } = {}) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('A database executor with a query method is required.');
  }

  return {
    async run() {
      const migrations = await loadMigrations(migrationsDirectory);
      for (const migration of migrations) {
        // PostgreSQL executes this one DO command atomically. The block takes a
        // transaction-scoped advisory lock, checks the checksum, applies every
        // statement, and writes the ledger only after all statements succeed.
        await executor.query(buildApplyMigrationSql(migration), []);
      }
      return migrations.map(({ filename, version, checksum }) => ({ filename, version, checksum }));
    },
  };
}

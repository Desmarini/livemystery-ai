import test from 'node:test';
import assert from 'node:assert/strict';
import { createMigrationRunner, orderMigrations, readMigrationFiles, splitSqlStatements } from '../server/database/migrations/runner.js';

function migration(version, checksum, statements = ['CREATE TABLE migration_test (id INTEGER)']) {
  return { filename: `${version}.sql`, version, checksum, statements };
}

function parseMigrationIdentity(query) {
  const version = query.match(/WHERE version = '([^']+)'/)?.[1];
  const checksum = query.match(/VALUES \('([^']+)', '([a-f0-9]{64})'\)/)?.[2];
  if (!version || !checksum) throw new Error('Migration command did not contain a version and checksum.');
  return { version, checksum };
}

function createLedgerExecutor() {
  const ledger = new Map();
  const calls = [];
  let queue = Promise.resolve();
  let appliedCount = 0;

  return {
    calls,
    ledger,
    get appliedCount() { return appliedCount; },
    query(query, parameters) {
      calls.push({ query, parameters });
      const work = queue.then(async () => {
        const { version, checksum } = parseMigrationIdentity(query);
        const existing = ledger.get(version);
        if (existing && existing !== checksum) throw new Error(`Migration checksum mismatch for version ${version}`);
        if (existing) return [];
        if (query.includes('FAIL_MIGRATION')) throw new Error('simulated transactional migration failure');
        ledger.set(version, checksum);
        appliedCount += 1;
        return [];
      });
      queue = work.catch(() => undefined);
      return work;
    },
  };
}

test('migration files are read in filename order and preserve PL/pgSQL bodies', async () => {
  const migrations = await readMigrationFiles();
  assert.deepEqual(migrations.map(({ version }) => version), ['001_initial', '002_schema_migrations']);
  assert.ok(migrations[0].statements.some((statement) => statement.includes('livemystery_set_updated_at')));
});

test('SQL splitter keeps dollar-quoted bodies as one transactional statement', () => {
  const statements = splitSqlStatements("CREATE FUNCTION example() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1; END; $$; CREATE TABLE example_table (id integer);");
  assert.equal(statements.length, 2);
  assert.match(statements[0], /PERFORM 1;/);
});

test('SQL splitter supports nested block comments and PostgreSQL escape strings', () => {
  const nestedComments = splitSqlStatements('/* outer; /* inner; */ still outer; */ SELECT 1; SELECT 2;');
  assert.deepEqual(nestedComments, ['/* outer; /* inner; */ still outer; */ SELECT 1', 'SELECT 2']);

  const escapedString = splitSqlStatements("SELECT E'it\\'s; one string'; SELECT 2;");
  assert.equal(escapedString.length, 2);
  assert.match(escapedString[0], /it\\'s;/);
});

test('migration files are ordered by numeric version, including versions longer than three digits', () => {
  const ordered = orderMigrations([
    migration('1000_later', 'a'.repeat(64)),
    migration('010_ten', 'b'.repeat(64)),
    migration('002_two', 'c'.repeat(64)),
  ]);
  assert.deepEqual(ordered.map(({ version }) => version), ['002_two', '010_ten', '1000_later']);
});

test('migration files with the same numeric version are rejected even when names differ', () => {
  assert.throws(
    () => orderMigrations([
      migration('002_alpha', 'a'.repeat(64)),
      migration('2_beta', 'b'.repeat(64)),
    ]),
    /Duplicate numeric migration version: 2/,
  );
});

test('migration runner submits ordered migrations through the executor query contract', async () => {
  const executor = createLedgerExecutor();
  const migrations = [
    migration('001_first', 'a'.repeat(64)),
    migration('002_second', 'b'.repeat(64)),
  ];
  const runner = createMigrationRunner({ executor, loadMigrations: async () => migrations });

  await runner.run();

  assert.equal(executor.appliedCount, 2);
  assert.equal(executor.calls.length, 2);
  assert.deepEqual(executor.calls.map(({ parameters }) => parameters), [[], []]);
  assert.match(executor.calls[0].query, /pg_advisory_xact_lock/);
  assert.match(executor.calls[0].query, /INSERT INTO schema_migrations/);
  assert.ok(executor.calls[0].query.indexOf('CREATE TABLE migration_test') < executor.calls[0].query.indexOf('INSERT INTO schema_migrations'));
});

test('migration runner accepts an already applied migration with the same checksum', async () => {
  const executor = createLedgerExecutor();
  const migrations = [migration('001_first', 'a'.repeat(64))];
  const runner = createMigrationRunner({ executor, loadMigrations: async () => migrations });

  await runner.run();
  await runner.run();

  assert.equal(executor.appliedCount, 1);
  assert.equal(executor.ledger.get('001_first'), 'a'.repeat(64));
});

test('migration runner rejects a changed checksum without replacing the applied ledger value', async () => {
  const executor = createLedgerExecutor();
  await createMigrationRunner({
    executor,
    loadMigrations: async () => [migration('001_first', 'a'.repeat(64))],
  }).run();

  await assert.rejects(
    createMigrationRunner({
      executor,
      loadMigrations: async () => [migration('001_first', 'b'.repeat(64))],
    }).run(),
    /checksum mismatch/,
  );
  assert.equal(executor.ledger.get('001_first'), 'a'.repeat(64));
});

test('a failed migration does not write its ledger row or continue to later migrations', async () => {
  const executor = createLedgerExecutor();
  const migrations = [
    migration('001_first', 'a'.repeat(64), ['FAIL_MIGRATION']),
    migration('002_second', 'b'.repeat(64)),
  ];

  await assert.rejects(
    createMigrationRunner({ executor, loadMigrations: async () => migrations }).run(),
    /simulated transactional migration failure/,
  );
  assert.equal(executor.ledger.size, 0);
  assert.equal(executor.calls.length, 1);
});

test('concurrent runners serialize ledger updates and apply each migration once', async () => {
  const executor = createLedgerExecutor();
  const migrations = [migration('001_first', 'a'.repeat(64))];
  const first = createMigrationRunner({ executor, loadMigrations: async () => migrations });
  const second = createMigrationRunner({ executor, loadMigrations: async () => migrations });

  await Promise.all([first.run(), second.run()]);

  assert.equal(executor.appliedCount, 1);
  assert.equal(executor.ledger.size, 1);
  assert.equal(executor.calls.length, 2);
});

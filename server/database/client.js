import { neon } from '@neondatabase/serverless';
import { getDatabaseUrl } from './config.js';

export function createDatabaseClient(environment = process.env) {
  const sql = neon(getDatabaseUrl(environment));
  return {
    query(query, parameters = []) {
      return sql.query(query, parameters);
    },
  };
}

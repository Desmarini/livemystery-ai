export function getDatabaseUrl(environment = process.env) {
  const databaseUrl = environment.DATABASE_URL;
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) {
    throw new Error('DATABASE_URL is required only for Netlify database operations. Local mode does not use a database.');
  }
  return databaseUrl;
}

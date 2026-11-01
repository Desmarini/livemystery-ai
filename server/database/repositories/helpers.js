export function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('A database executor with a query method is required.');
  }
}

export function asJson(value) {
  return JSON.stringify(value);
}

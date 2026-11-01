import { timingSafeEqual } from 'node:crypto';

function equalSecrets(left, right) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function isMigrationAuthorized(request, environment = process.env) {
  const expectedToken = environment.MIGRATION_ADMIN_TOKEN;
  const authorization = request.headers.get('authorization');
  const receivedToken = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];

  return typeof expectedToken === 'string'
    && expectedToken.length > 0
    && typeof receivedToken === 'string'
    && equalSecrets(receivedToken, expectedToken);
}

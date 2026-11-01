import { requireExecutor } from './helpers.js';

export function createChatCommandCooldownRepository(executor) {
  requireExecutor(executor);
  return {
    async claim({ broadcasterUserId, chatterUserId, cooldownSeconds }) {
      const rows = await executor.query(
        `INSERT INTO chat_command_cooldowns (broadcaster_user_id, chatter_user_id, last_command_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (broadcaster_user_id, chatter_user_id) DO UPDATE
           SET last_command_at = NOW()
           WHERE chat_command_cooldowns.last_command_at <= NOW() - ($3 * INTERVAL '1 second')
         RETURNING broadcaster_user_id, chatter_user_id, last_command_at`,
        [broadcasterUserId, chatterUserId, cooldownSeconds],
      );
      return rows[0] || null;
    },
  };
}

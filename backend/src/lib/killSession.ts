import { getSessionPool } from './session';

// connect-pg-simple stores session data as a `json` (not `jsonb`) blob with
// no index on any inner field -- fine here since this only runs on the rare
// admin action of deactivating an account, not on any request hot path.
export async function killSessionsForUser(userId: string): Promise<void> {
  await getSessionPool().query(`DELETE FROM "session" WHERE (sess::jsonb ->> 'userId') = $1`, [userId]);
}

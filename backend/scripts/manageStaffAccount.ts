// Staff account lifecycle (create / deactivate / reactivate / reset-password
// / list) for whoever administers this deployment after handoff.
//
// This used to be the *only* way to manage accounts, deliberately kept off
// the web app's trust boundary (an admin web session couldn't escalate to
// minting new accounts). routes/adminUsers.ts now offers the same
// operations through the web UI instead -- a later, explicit product
// decision to trade that isolation for usability (see the migration
// 20260827090000_grant_staff_account_to_admin comment for the trade-off).
// This script remains for server-side/scripted use and as a fallback if the
// web app itself is ever unreachable but the database is not.
//
// Usage (DATABASE_URL must be the migration-owner superuser connection --
// see docker/secrets/README.md):
//   DATABASE_URL=... npx tsx scripts/manageStaffAccount.ts list
//   DATABASE_URL=... npx tsx scripts/manageStaffAccount.ts create <username> <full name> <role>
//   DATABASE_URL=... npx tsx scripts/manageStaffAccount.ts deactivate <username>
//   DATABASE_URL=... npx tsx scripts/manageStaffAccount.ts reactivate <username>
//   DATABASE_URL=... npx tsx scripts/manageStaffAccount.ts reset-password <username>
//
// `create` and `reset-password` print a one-time generated password to
// stdout -- it is never stored in plaintext, only its bcrypt hash. Roles:
// admin, office_staff (StaffRole enum in schema.prisma) -- every office,
// CSWD/Agriculture/Civil Registry included, is office_staff now; which
// office an account belongs to is set separately via office_id, which this
// script doesn't manage (use the admin web UI's Offices/Staff Accounts
// pages, or set office_id by hand for a script-created account).
import { Client } from 'pg';
import { env } from '../src/env';
import { generatePassword, hashPassword } from '../src/lib/staffAccountCredentials';

const VALID_ROLES = ['admin', 'office_staff'];

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const client = new Client({ connectionString: env.databaseUrl });
  await client.connect();

  try {
    switch (command) {
      case 'list': {
        const { rows } = await client.query(
          'SELECT username, full_name, role, is_active, created_at FROM staff_account ORDER BY role, username',
        );
        console.table(rows);
        break;
      }

      case 'create': {
        const [username, fullName, role] = args;
        if (!username || !fullName || !role) {
          throw new Error('Usage: create <username> <full name> <role>');
        }
        if (!VALID_ROLES.includes(role)) {
          throw new Error(`Invalid role "${role}". Must be one of: ${VALID_ROLES.join(', ')}`);
        }
        const password = generatePassword();
        const passwordHash = await hashPassword(password);
        // updated_at has no DB-level default -- Prisma's @updatedAt only
        // fires when writes go through Prisma Client, not raw SQL -- so it
        // must be set explicitly here or the NOT NULL constraint rejects
        // the insert.
        await client.query(
          'INSERT INTO staff_account (username, password_hash, full_name, role, updated_at) VALUES ($1, $2, $3, $4, now())',
          [username, passwordHash, fullName, role],
        );
        console.log(`Created ${username} (${role}). One-time password: ${password}`);
        console.log('Give this to the staff member directly, out of band -- it is not stored anywhere.');
        break;
      }

      case 'deactivate': {
        const [username] = args;
        if (!username) throw new Error('Usage: deactivate <username>');
        const { rowCount } = await client.query(
          'UPDATE staff_account SET is_active = false, updated_at = now() WHERE username = $1',
          [username],
        );
        if (rowCount === 0) throw new Error(`No such account: ${username}`);
        console.log(`Deactivated ${username}. Their active sessions still work until idle timeout; nothing here revokes an in-progress session (see ops/README.md if immediate revocation is needed).`);
        break;
      }

      case 'reactivate': {
        const [username] = args;
        if (!username) throw new Error('Usage: reactivate <username>');
        const { rowCount } = await client.query(
          'UPDATE staff_account SET is_active = true, updated_at = now() WHERE username = $1',
          [username],
        );
        if (rowCount === 0) throw new Error(`No such account: ${username}`);
        console.log(`Reactivated ${username}.`);
        break;
      }

      case 'reset-password': {
        const [username] = args;
        if (!username) throw new Error('Usage: reset-password <username>');
        const password = generatePassword();
        const passwordHash = await hashPassword(password);
        const { rowCount } = await client.query(
          'UPDATE staff_account SET password_hash = $1, updated_at = now() WHERE username = $2',
          [passwordHash, username],
        );
        if (rowCount === 0) throw new Error(`No such account: ${username}`);
        console.log(`Reset password for ${username}. One-time password: ${password}`);
        break;
      }

      default:
        throw new Error(
          `Unknown command "${command ?? ''}". Expected one of: list, create, deactivate, reactivate, reset-password`,
        );
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

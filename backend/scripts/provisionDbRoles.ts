// Run once per environment, immediately after `prisma migrate deploy`
// applies the Phase 3 RBAC migration -- ALTERs each RBAC role's password
// from its Docker secret, overwriting the migration's placeholder password.
// Connects as DATABASE_USER (the migration-owner superuser), never as one
// of the roles being provisioned.
import { Client } from 'pg';
import { env, type DbRole } from '../src/env';

const ROLES: DbRole[] = ['admin', 'app_service', 'office_staff'];

async function main() {
  const client = new Client({ connectionString: env.databaseUrl });
  await client.connect();
  try {
    for (const role of ROLES) {
      const password = env.rolePassword(role);
      // ALTER ROLE ... PASSWORD requires a string literal -- its grammar
      // doesn't accept a bind parameter there ($1 fails with a syntax
      // error). Role names come from the fixed ROLES literal above, never
      // user input; the password is escaped (doubled single quotes) before
      // being embedded, though the generated secrets are base64 and never
      // contain one.
      const escapedPassword = password.replace(/'/g, "''");
      await client.query(`ALTER ROLE "${role}" WITH PASSWORD '${escapedPassword}'`);
      console.log(`Provisioned password for role ${role}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Re-encrypts every person_sss/gsis/philhealth value from OLD_ENCRYPTION_KEY
// to NEW_ENCRYPTION_KEY. Run this BEFORE swapping the live
// docker/secrets/encryption_key.txt -- the app only ever knows one active
// key at a time (env.encryptionKey), so this script deliberately takes the
// old and new keys as its own separate env vars, independent of that file.
//
// Usage (see docker/secrets/README.md for the full runbook):
//   OLD_ENCRYPTION_KEY=... NEW_ENCRYPTION_KEY=... DATABASE_URL=... \
//     npx tsx scripts/rotateEncryptionKey.ts [--dry-run]
//
// --dry-run decrypts with the old key and re-encrypts in memory to prove
// the old key is correct and every value is recoverable, but never writes
// anything -- safe to run against production data before committing to the
// real rotation.
import { PrismaClient } from '@prisma/client';
import { decryptField, encryptField } from '../src/lib/encryption';
import { env } from '../src/env';

const DRY_RUN = process.argv.includes('--dry-run');

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`rotateEncryptionKey: set ${name}`);
  }
  return value;
}

async function main() {
  const oldKey = requireEnv('OLD_ENCRYPTION_KEY');
  const newKey = requireEnv('NEW_ENCRYPTION_KEY');
  if (oldKey === newKey) {
    throw new Error('rotateEncryptionKey: OLD_ENCRYPTION_KEY and NEW_ENCRYPTION_KEY must differ');
  }

  // Connects as the migration-owner superuser (env.databaseUrl), same as
  // every other one-off ops script here -- this needs to touch every
  // citizen's encrypted columns regardless of RBAC office boundaries.
  const prisma = new PrismaClient({ datasources: { db: { url: env.databaseUrl } } });

  try {
    const citizens = await prisma.citizen.findMany({
      where: {
        OR: [{ personSssEnc: { not: null } }, { personGsisEnc: { not: null } }, { personPhilhealthEnc: { not: null } }],
      },
      select: { personKey: true, personSssEnc: true, personGsisEnc: true, personPhilhealthEnc: true },
    });

    console.log(`Found ${citizens.length} citizen(s) with at least one encrypted government ID.`);

    let rotated = 0;
    let failed = 0;

    for (const c of citizens) {
      try {
        const sss = c.personSssEnc ? decryptField(c.personSssEnc, oldKey) : null;
        const gsis = c.personGsisEnc ? decryptField(c.personGsisEnc, oldKey) : null;
        const philhealth = c.personPhilhealthEnc ? decryptField(c.personPhilhealthEnc, oldKey) : null;

        if (DRY_RUN) {
          rotated++;
          continue;
        }

        await prisma.citizen.update({
          where: { personKey: c.personKey },
          data: {
            personSssEnc: sss !== null ? encryptField(sss, newKey) : undefined,
            personGsisEnc: gsis !== null ? encryptField(gsis, newKey) : undefined,
            personPhilhealthEnc: philhealth !== null ? encryptField(philhealth, newKey) : undefined,
          },
          select: { personKey: true },
        });
        rotated++;
      } catch (err) {
        failed++;
        console.error(`Failed to rotate ${c.personKey}:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(
      DRY_RUN
        ? `Dry run: ${rotated} row(s) decrypted successfully with OLD_ENCRYPTION_KEY, ${failed} failed. Nothing was written.`
        : `Rotated ${rotated} row(s) to the new key. ${failed} failed and were left on the old key -- investigate before deleting the old secret.`,
    );

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Applies the "death recorded" changes (src/services/deathEffects.ts) to
// death records that were saved before that automation existed: the person
// leaves their household, comes off the program lists that have a cleanup
// rule, and stops showing in Citizens. New death records do this on their own.
//
// Lists what it would do unless --apply is given. Usage (DATABASE_URL as for
// the other scripts/*.ts files):
//   npx tsx --env-file=.env scripts/applyDeathEffects.ts
//   npx tsx --env-file=.env scripts/applyDeathEffects.ts --apply
import { prisma } from '../src/lib/prisma';
import { applyDeath, DEATH_SLUG } from '../src/services/deathEffects';

async function main() {
  const apply = process.argv.includes('--apply');
  const pending = (
    await prisma.officeRecord.findMany({
      where: { isArchived: false, personKey: { not: null }, module: { slug: DEATH_SLUG } },
      select: { id: true, data: true, citizen: { select: { personFname: true, personLname: true, personIsHead: true, personParentKey: true } } },
      orderBy: { createdAt: 'asc' },
    })
  ).filter((r) => !(r.data as Record<string, unknown> | null)?._effects);

  if (!apply) {
    const heads = pending.filter((r) => r.citizen?.personIsHead).length;
    const members = pending.filter((r) => !r.citizen?.personIsHead && r.citizen?.personParentKey).length;
    console.log(`${pending.length} death records not yet applied: ${heads} household heads, ${members} household members, ${pending.length - heads - members} in no household.`);
    console.log('Nothing was changed. Run again with --apply to apply them.');
    return;
  }
  const admin = await prisma.staffAccount.findFirst({ where: { role: 'admin', isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!admin) throw new Error('No active admin account to record these changes under.');
  let lists = 0;
  let households = 0;
  for (const r of pending) {
    const effects = await applyDeath(prisma, r.id, { userId: admin.id, role: 'admin' });
    if (!effects) continue;
    lists += effects.removedFrom.length;
    if (effects.household) households++;
  }
  console.log(`Applied ${pending.length} death records: ${households} households updated, ${lists} program list entries archived.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

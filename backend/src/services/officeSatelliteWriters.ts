import type { Prisma } from '@prisma/client';

// Accepts a plain PrismaClient or an open transaction client -- callers
// that need this inside a $transaction (the duplicate-review approve/reject
// flow) pass their `tx`; PrismaClient itself structurally satisfies this
// too.
type QueryableClient = Prisma.TransactionClient;

// The one satellite-record writer every office/module uses -- see the
// OfficeRecord model's comment in schema.prisma. personKey is null only for
// a module with requiresCitizenLink = false (Civil Registry's Birth is the
// only one today) where the submitter didn't ask to link a Citizen; in that
// case unresolvedPerson carries {lname, fname, mname, bdate} since there's
// no Citizen row to read them from. Shared between office.ts's own intake
// route and adminReview.ts's approve/reject (duplicate-review-queue replay)
// flow, which both need to turn a validated submission into a saved record
// once a person_key is known (or deliberately isn't).
export async function createOfficeRecord(
  client: QueryableClient,
  moduleId: string,
  personKey: string | null,
  unresolvedPerson: Record<string, unknown> | null,
  data: Record<string, unknown>,
  actorUserId: string,
): Promise<{ table: string; recordId: string }> {
  const record = await client.officeRecord.create({
    data: {
      moduleId,
      personKey: personKey ?? undefined,
      unresolvedPerson: (unresolvedPerson ?? undefined) as Prisma.InputJsonValue | undefined,
      data: data as Prisma.InputJsonValue,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    },
  });
  return { table: 'OfficeRecord', recordId: record.id };
}

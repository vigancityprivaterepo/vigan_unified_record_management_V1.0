import { prisma } from '../lib/prisma';

// Test-only fixture reset -- deletes in FK-safe order. Never call outside
// the test suite.
//
// Office/OfficeModule/OfficeFormField are deliberately NOT reset here, same
// as Barangay never was -- they're reference/config data, not per-test
// churn, and seeded staff_account rows (cswd.demo etc.) now hold a live FK
// to their office, so wiping offices between tests would break every other
// test file's loginAgent() call. Tests that need their own office/module
// fixture create one with a randomized slug (mirroring how barangay tests
// upsert on a fixed code) instead of relying on a clean slate.
export async function resetDb(): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.duplicateReviewQueueItem.deleteMany();
  await prisma.dashboardWidget.deleteMany();
  await prisma.officeRecord.deleteMany();
  await prisma.citizen.deleteMany();
}

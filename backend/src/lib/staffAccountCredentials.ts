import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

// Shared by both scripts/manageStaffAccount.ts (the superuser CLI path) and
// routes/adminUsers.ts (the admin-role web path) -- one place for password
// generation and hashing so the two paths can't drift to different
// strengths.
export function generatePassword(): string {
  return crypto.randomBytes(18).toString('base64');
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

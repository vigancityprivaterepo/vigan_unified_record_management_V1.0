import 'express-session';
import type { StaffRole } from '@prisma/client';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    username?: string;
    fullName?: string;
    position?: string;
    role?: StaffRole;
    // Only set when role === 'office_staff' -- which dynamic office this
    // session is scoped to.
    officeId?: string;
  }
}

import type { Response } from 'express';

// One consistent JSON error shape across every endpoint, per the Phase 0
// cross-cutting conventions -- retrofitting this later would touch every
// route.
export function sendError(res: Response, status: number, code: string, message: string, details?: unknown): void {
  res.status(status).json({ error: { code, message, details: details ?? null } });
}

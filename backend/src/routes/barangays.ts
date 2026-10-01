import { Router } from 'express';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireAuth } from '../middleware/auth';

export const barangaysRouter = Router();

// Reference lookup for intake forms -- every office role has SELECT on
// barangay (Phase 3 migration), so just requireAuth, not a specific role.
barangaysRouter.get('/', requireAuth, async (req, res) => {
  const client = getPrismaForRole(req.session.role!);
  const barangays = await client.barangay.findMany({ orderBy: { name: 'asc' } });
  res.json(barangays);
});

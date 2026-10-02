import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireRole } from '../middleware/auth';
import {
  computeBarangayRanking,
  computeBucketCitizens,
  computeSankeyData,
  computeSummary,
  computeTrend,
  type InsightsFilterParams,
} from '../services/insights';
import { computeOfficeBreakdown } from '../services/officeBreakdown';
import { pace, quality, reach, underserved } from '../services/cityInsights';

export const adminInsightsRouter = Router();
adminInsightsRouter.use(requireRole('admin'));

function strParam(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function filtersFromQuery(query: Record<string, unknown>): InsightsFilterParams {
  return { barangayCode: strParam(query.barangayCode), from: strParam(query.from), to: strParam(query.to) };
}

adminInsightsRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole('admin');
    const summary = await computeSummary(client, filtersFromQuery(req.query));
    res.json(summary);
  }),
);

adminInsightsRouter.get(
  '/sankey',
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole('admin');
    const data = await computeSankeyData(client, filtersFromQuery(req.query));
    res.json(data);
  }),
);

adminInsightsRouter.get(
  '/barangay-ranking',
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole('admin');
    const rows = await computeBarangayRanking(client, filtersFromQuery(req.query));
    res.json(rows);
  }),
);

adminInsightsRouter.get(
  '/trend',
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole('admin');
    const points = await computeTrend(client, filtersFromQuery(req.query));
    res.json(points);
  }),
);

adminInsightsRouter.get(
  '/citizens',
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole('admin');
    const bucketParam = strParam(req.query.bucket);
    const limitParam = strParam(req.query.limit);
    const rows = await computeBucketCitizens(client, {
      ...filtersFromQuery(req.query),
      bucketModuleIds: bucketParam ? bucketParam.split(',').filter(Boolean) : undefined,
      limit: limitParam ? Number(limitParam) : undefined,
    });
    res.json(rows);
  }),
);

adminInsightsRouter.get(
  '/office-breakdown',
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole('admin');
    res.json(await computeOfficeBreakdown(client, filtersFromQuery(req.query)));
  }),
);

// The Insights page: four questions officials ask (services/cityInsights.ts).
// Counts only, no names.
adminInsightsRouter.get(
  '/questions',
  asyncHandler(async (_req, res) => {
    const client = getPrismaForRole('admin');
    const [u, r, p, q] = await Promise.all([underserved(client), reach(client), pace(client), quality(client)]);
    res.json({ underserved: u, reach: r, pace: p, quality: q });
  }),
);

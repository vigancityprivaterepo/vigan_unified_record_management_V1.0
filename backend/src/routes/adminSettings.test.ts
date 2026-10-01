import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { setSetting } from '../services/config';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

describe('/admin/settings', () => {
  const app = createApp();

  beforeEach(resetDb);

  afterEach(async () => {
    // resetDb re-seeds migrations' defaults, but be explicit anyway so a
    // failed assertion mid-test can't leak a bad threshold into later files.
    await setSetting('FUZZY_MATCH_THRESHOLD', '0.6');
    await setSetting('FUZZY_MATCH_BDATE_TOLERANCE_DAYS', '5');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects non-admin roles', async () => {
    const agent = await loginAgent(app, 'cswd.demo');
    const res = await agent.get('/admin/settings');
    expect(res.status).toBe(403);
  });

  it('reads both settings with their seeded defaults', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.get('/admin/settings');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ FUZZY_MATCH_THRESHOLD: '0.6', FUZZY_MATCH_BDATE_TOLERANCE_DAYS: '5' });
  });

  it('updates a setting and the change round-trips through a fresh read', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    const patchRes = await agent.patch('/admin/settings').send({ key: 'FUZZY_MATCH_THRESHOLD', value: '0.75' });
    expect(patchRes.status).toBe(200);

    const getRes = await agent.get('/admin/settings');
    expect(getRes.body.FUZZY_MATCH_THRESHOLD).toBe('0.75');
  });

  it('rejects a threshold outside 0-1', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.patch('/admin/settings').send({ key: 'FUZZY_MATCH_THRESHOLD', value: '1.5' });
    expect(res.status).toBe(400);
  });

  it('rejects a non-numeric value', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.patch('/admin/settings').send({ key: 'FUZZY_MATCH_BDATE_TOLERANCE_DAYS', value: 'not-a-number' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown setting key', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.patch('/admin/settings').send({ key: 'NOT_A_REAL_SETTING', value: '1' });
    expect(res.status).toBe(400);
  });
});

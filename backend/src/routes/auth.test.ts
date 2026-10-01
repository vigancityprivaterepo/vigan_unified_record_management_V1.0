import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { authPrisma } from '../lib/authPrisma';
import { prisma } from '../lib/prisma';

const DEV_PASSWORD = 'dev-password-not-for-prod';

describe('auth: login / logout / session idle timeout', () => {
  afterAll(async () => {
    await authPrisma.$disconnect();
    await prisma.$disconnect();
  });

  it('rejects bad credentials without revealing whether the username exists', async () => {
    const app = createApp();
    const res = await request(app).post('/auth/login').send({ username: 'cswd.demo', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a malformed login payload with the standard error shape', async () => {
    const app = createApp();
    const res = await request(app).post('/auth/login').send({ username: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('audit-logs a failed login attempt', async () => {
    const app = createApp();
    const res = await request(app).post('/auth/login').send({ username: 'cswd.demo', password: 'wrong' });
    expect(res.status).toBe(401);

    const failedAudit = await prisma.auditLog.findFirst({
      where: { tableName: 'staff_account', action: 'read', changedFields: { path: ['event'], equals: 'login_failed' } },
      orderBy: { timestamp: 'desc' },
    });
    expect(failedAudit).not.toBeNull();
    expect(failedAudit?.actorUserId).toBeNull();
  });

  it('rate-limits repeated login attempts', async () => {
    const app = createApp({ loginRateLimit: { windowMs: 60_000, limit: 3 } });

    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/auth/login').send({ username: 'cswd.demo', password: 'wrong' });
      expect(res.status).toBe(401);
    }

    const limitedRes = await request(app).post('/auth/login').send({ username: 'cswd.demo', password: 'wrong' });
    expect(limitedRes.status).toBe(429);
  });

  it('logs in, exposes the session via /auth/me, logs out, and audit-logs both events', async () => {
    const app = createApp();
    const agent = request.agent(app);

    const loginRes = await agent.post('/auth/login').send({ username: 'cswd.demo', password: DEV_PASSWORD });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.role).toBe('office_staff');

    const meRes = await agent.get('/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.username).toBe('cswd.demo');

    const logoutRes = await agent.post('/auth/logout');
    expect(logoutRes.status).toBe(204);

    const meAfterLogout = await agent.get('/auth/me');
    expect(meAfterLogout.status).toBe(401);

    const loginAudit = await prisma.auditLog.findFirst({
      where: { tableName: 'staff_account', action: 'read', changedFields: { path: ['event'], equals: 'login' } },
      orderBy: { timestamp: 'desc' },
    });
    expect(loginAudit?.actorRole).toBe('office_staff');

    const logoutAudit = await prisma.auditLog.findFirst({
      where: { tableName: 'staff_account', action: 'read', changedFields: { path: ['event'], equals: 'logout' } },
      orderBy: { timestamp: 'desc' },
    });
    expect(logoutAudit?.actorRole).toBe('office_staff');
  });

  it('expires the session after the configured idle timeout', async () => {
    // The cookie's Expires attribute is an HTTP date -- 1-second
    // resolution -- so a sub-second maxAge rounds unreliably. 1.5s (well
    // under the ~30min default) keeps this a real expiry test without that
    // flakiness.
    const app = createApp({ sessionIdleTimeoutMs: 1500 });
    const agent = request.agent(app);

    const loginRes = await agent.post('/auth/login').send({ username: 'admin.demo', password: DEV_PASSWORD });
    expect(loginRes.status).toBe(200);

    const meImmediately = await agent.get('/auth/me');
    expect(meImmediately.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 2200));

    const meAfterIdle = await agent.get('/auth/me');
    expect(meAfterIdle.status).toBe(401);
  }, 10000);

  it('resets the idle timer on activity ("rolling" session -- not an absolute timeout)', async () => {
    // A wider window (3s) with generous margin under it (1.2s gaps) so this
    // stays reliable even under the load of the earlier tests in this file
    // (each spins up its own Express app + session store).
    const app = createApp({ sessionIdleTimeoutMs: 3000 });
    const agent = request.agent(app);

    await agent.post('/auth/login').send({ username: 'agri.demo', password: DEV_PASSWORD });

    // Two requests spaced under the idle window, each resetting it --
    // total elapsed exceeds the timeout, but the session should survive
    // because neither individual gap did.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const midway = await agent.get('/auth/me');
    expect(midway.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const stillAlive = await agent.get('/auth/me');
    expect(stillAlive.status).toBe(200);
  }, 10000);
});

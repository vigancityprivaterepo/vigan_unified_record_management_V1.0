import type { Application } from 'express';
import request from 'supertest';

const DEV_PASSWORD = 'dev-password-not-for-prod';

// Logs in as one of the seeded demo staff accounts (see prisma/seed.ts) and
// returns a cookie-carrying supertest agent for tests that need an
// authenticated session but aren't testing the login endpoint itself.
export async function loginAgent(app: Application, username: string): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').send({ username, password: DEV_PASSWORD });
  if (res.status !== 200) {
    throw new Error(`loginAgent: login as ${username} failed with status ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return agent;
}

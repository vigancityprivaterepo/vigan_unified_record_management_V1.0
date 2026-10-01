import session, { type SessionOptions } from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import { env } from '../env';

const PgSession = connectPgSimple(session);

// One pool per process, not per createSessionMiddleware() call -- a fresh
// Pool per call (e.g. one per createApp() in tests) leaks connections that
// are never closed, and under enough accumulated load was measurably
// slowing down session reads/writes.
let sessionPool: Pool | undefined;
export function getSessionPool(): Pool {
  if (!sessionPool) {
    sessionPool = new Pool({ connectionString: env.databaseUrlForRole('app_service') });
  }
  return sessionPool;
}

// Idle timeout, not absolute: `rolling: true` resets the cookie's maxAge on
// every request, so a session survives as long as the user keeps working
// but expires `idleTimeoutMs` after the last request -- shared front-desk
// workstations shouldn't stay logged in indefinitely (spec: ~30 min idle).
export function createSessionMiddleware(idleTimeoutMs: number = env.sessionIdleTimeoutMinutes * 60 * 1000) {
  const options: SessionOptions = {
    store: new PgSession({ pool: getSessionPool(), tableName: 'session', createTableIfMissing: false }),
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.cookieSecure,
      maxAge: idleTimeoutMs,
    },
  };

  return session(options);
}

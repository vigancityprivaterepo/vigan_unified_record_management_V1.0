import { useState } from 'react';
import logoUrl from '@/logo.png';
import { api, ApiError, type Session } from '@/lib/api';

export function LoginPage({ onLogin }: { onLogin: (session: Session) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const session = await api.login(username, password);
      onLogin(session);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-main">
        <div className="auth-brand">
          <div className="logo">
            <img src={logoUrl} alt="City of Vigan seal" />
          </div>
          <div className="name">Vigan UCRMS</div>
        </div>

        <div className="auth-card">
          <h2>Sign in</h2>
          <p className="sub">Use your office account to continue.</p>

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="field">
              <label className="field-label" htmlFor="username">
                Username
              </label>
              <input
                id="username"
                className="input"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="input"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <div className="alert danger">
                <div className="ico">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 8v5M12 16h.01" />
                  </svg>
                </div>
                <div className="body">{error}</div>
              </div>
            )}
            <button type="submit" className="btn btn--primary auth-submit" disabled={submitting}>
              {submitting && <span className="spinner sm" />}
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>

        <div className="auth-main-bottom">
          <div>Vigan City LGU internal staff system, not for public access.</div>
          <div>Internal use only &middot; Personal data here is covered by the Data Privacy Act (RA 10173).</div>
        </div>
      </div>
    </div>
  );
}

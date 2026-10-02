import { useEffect, useState } from 'react';
import { api, ApiError, type ReviewQueueItem } from '@/lib/api';

export function DuplicateReviewQueuePage() {
  const [items, setItems] = useState<ReviewQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh() {
    api
      .reviewQueue()
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load queue'));
  }

  useEffect(refresh, []);

  async function handleApprove(item: ReviewQueueItem, winningPersonKey: string) {
    setBusyId(item.id);
    setError(null);
    try {
      await api.approveReview(item.id, winningPersonKey);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Approve failed');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(item: ReviewQueueItem) {
    setBusyId(item.id);
    setError(null);
    try {
      await api.rejectReview(item.id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reject failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="hero">
        <div className="hero-text">
          <h1 className="hero-title">Duplicate review</h1>
        </div>
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

      {items === null && <span className="spinner" />}
      {items?.length === 0 && <p style={{ color: 'var(--t-muted)', fontSize: 13 }}>Nothing pending review.</p>}

      {items?.map((item) => (
        <div className="card" key={item.id}>
          <div className="card-head">
            <div className="card-title-wrap">
              <span className="eyebrow">
                {item.officeName ?? 'Unknown office'} {item.moduleName ? `· ${item.moduleName}` : ''}
              </span>
              <h3 className="card-title">
                {item.candidateData.lname}, {item.candidateData.fname}
                {item.candidateData.mname ? ` ${item.candidateData.mname}` : ''}
              </h3>
              <p className="card-desc">
                Birthdate {item.candidateData.bdate.slice(0, 10)} &middot; queued{' '}
                {new Date(item.createdAt).toLocaleString()}
              </p>
            </div>
            <span className="badge warning">Pending</span>
          </div>

          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--t-base)', marginBottom: 8 }}>
            Possible existing matches:
          </p>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {item.fuzzyMatches.map((c) => (
              <li
                key={c.personKey}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)',
                  padding: '10px 12px',
                  fontSize: 13,
                }}
              >
                <span>
                  {c.personLname}, {c.personFname}, born {c.personBdate?.slice(0, 10)} (similarity{' '}
                  {c.similarity.toFixed(2)})
                </span>
                <button
                  className="btn btn--primary btn--sm"
                  disabled={busyId === item.id}
                  onClick={() => handleApprove(item, c.personKey)}
                >
                  Same person: merge
                </button>
              </li>
            ))}
          </ul>
          <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 14 }}>
            <button className="btn btn--ghost btn--sm" disabled={busyId === item.id} onClick={() => handleReject(item)}>
              None of these: create as new person
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

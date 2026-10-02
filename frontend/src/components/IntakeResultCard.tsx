import type { IntakeResult } from '@/lib/api';

// Shared across every office intake form -- resolvePerson()'s three
// outcomes (plus Birth's "recorded, no citizen link" case) always render
// the same way regardless of which office submitted.
// The intake itself already saved by the time this could fire (see
// office.ts's intake route comment) -- shown as its own soft warning, not
// folded into the alert above, so "the record saved" and "the household
// link needs attention" read as two separate facts.
function HouseholdLinkWarning({ message }: { message: string }) {
  return (
    <div className="alert" style={{ marginTop: 8 }}>
      <div className="ico">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16h.01" />
        </svg>
      </div>
      <div className="body">
        <div className="title">Household link not applied</div>
        {message}. The record above was still saved; link the household separately from the Households page.
      </div>
    </div>
  );
}

export function IntakeResultCard({ result }: { result: IntakeResult }) {
  if (result.status === 'created') {
    return (
      <>
        <div className="alert success">
          <div className="ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <div className="body">
            <div className="title">New citizen registered</div>
            No existing record matched, so a new Citizen row was created and linked.
            <br />
            <span className="mono" style={{ fontSize: 12 }}>
              person_key: {result.personKey} &middot; Record: {result.recordId}
            </span>
          </div>
        </div>
        {result.householdLinkWarning && <HouseholdLinkWarning message={result.householdLinkWarning} />}
      </>
    );
  }

  if (result.status === 'matched') {
    return (
      <>
        <div className="alert info">
          <div className="ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 12l2 2 4-4" />
              <circle cx="12" cy="12" r="9" />
            </svg>
          </div>
          <div className="body">
            <div className="title">Linked to existing citizen</div>
            An exact match was found, so no duplicate Citizen row was created.
            <br />
            <span className="mono" style={{ fontSize: 12 }}>
              person_key: {result.personKey} &middot; Record: {result.recordId}
            </span>
          </div>
        </div>
        {result.householdLinkWarning && <HouseholdLinkWarning message={result.householdLinkWarning} />}
      </>
    );
  }

  if (result.status === 'recorded_no_citizen_link') {
    return (
      <div className="alert">
        <div className="ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h.01" />
          </svg>
        </div>
        <div className="body">
          <div className="title">Birth recorded</div>
          Not a Vigan resident: recorded with no Citizen row linked.
          <br />
          <span className="mono" style={{ fontSize: 12 }}>
            Record: {result.recordId}
          </span>
        </div>
      </div>
    );
  }

  if (result.status === 'recorded') {
    return (
      <div className="alert success">
        <div className="ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <div className="body">
          <div className="title">Record saved</div>
          <span className="mono" style={{ fontSize: 12 }}>
            Record: {result.recordId}
          </span>
        </div>
      </div>
    );
  }

  if (result.status !== 'needs_review') {
    return null;
  }

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title-wrap">
          <h3 className="card-title">Queued for admin review</h3>
        </div>
        <span className="badge warning">Needs review</span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--t-muted)', marginTop: 0 }}>
        Possible duplicates found. Nothing was saved yet. An admin will resolve this from the Duplicate Review
        Queue.
      </p>
      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--t-base)', marginBottom: 6 }}>Possible matches:</p>
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {result.candidates.map((c) => (
          <li
            key={c.personKey}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              padding: '8px 10px',
              fontSize: 13,
              background: 'var(--bg-muted)',
            }}
          >
            {c.personLname}, {c.personFname}, born {c.personBdate?.slice(0, 10)} (similarity {c.similarity.toFixed(2)})
          </li>
        ))}
      </ul>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Pagination } from '@/components/Pagination';
import { api, ApiError, type DuplicateCitizen, type DuplicatePair, type Paginated } from '@/lib/api';

// Citizens already in the registry who look like the same person (backend
// services/duplicateCitizens.ts). The administrator keeps one of the two, or
// says they are different people so the pair is not shown again.

const WHY: Record<DuplicatePair['reason'], string> = {
  same: 'Same name and birthdate',
  birthdate_typo: 'Same name, birthdate one digit off or day and month swapped',
  no_birthdate: 'Same name, one has no birthdate',
  similar_name: 'Same birthdate, similar name',
};

function Person({ person, busy, onKeep }: { person: DuplicateCitizen; busy: boolean; onKeep: () => void }) {
  const facts = [
    person.bdate ? `Born ${person.bdate}` : 'No birthdate',
    person.sex,
    person.barangay,
    person.household,
    person.programs.length > 0 ? person.programs.join(', ') : 'No program records',
    `Added ${new Date(person.createdAt).toLocaleDateString('en-PH', { dateStyle: 'medium' })}`,
  ].filter(Boolean);
  return (
    <div style={{ flex: '1 1 260px', minWidth: 0, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <strong style={{ overflowWrap: 'anywhere' }}>
        {person.lname}, {person.fname}{person.mname ? ` ${person.mname}` : ''}
      </strong>
      <ul style={{ fontSize: 13, color: 'var(--t-muted)', display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        {facts.map((fact) => <li key={fact} style={{ overflowWrap: 'anywhere' }}>{fact}</li>)}
      </ul>
      <button type="button" className="btn btn--primary btn--sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={onKeep}>
        Same person: keep this one
      </button>
    </div>
  );
}

export function RegistryDuplicates() {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<DuplicatePair> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    api
      .duplicateCitizens(page)
      .then((r) => { if (current) setResult(r); })
      .catch((err) => { if (current) setError(err instanceof ApiError ? err.message : 'Could not load the possible duplicates'); });
    return () => { current = false; };
  }, [page, attempt]);

  async function decide(pair: DuplicatePair, action: () => Promise<unknown>) {
    setBusy(pair.a.personKey + pair.b.personKey);
    setError(null);
    try {
      await action();
      // The last pair of a page: step back so the list does not come up empty.
      if (result && result.items.length === 1 && page > 1) setPage(page - 1);
      else setAttempt((n) => n + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not go through');
    } finally {
      setBusy(null);
    }
  }

  function keep(pair: DuplicatePair, kept: DuplicateCitizen, other: DuplicateCitizen) {
    const name = (p: DuplicateCitizen) => `${p.fname} ${p.lname}`;
    if (!window.confirm(`Keep ${name(kept)} and move everything recorded under ${name(other)} to them? ${name(other)} will be archived.`)) return;
    void decide(pair, () => api.mergeCitizens(kept.personKey, other.personKey));
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 className="card-title">Possible duplicates in the registry</h2>
        <p className="card-desc">
          Citizens already saved who look like the same person.
          {result && result.total > 0 ? ` ${result.total.toLocaleString()} to check.` : ''}
        </p>
      </div>

      {error && <div className="field-error">{error}</div>}
      {result === null && !error && <span className="spinner" />}
      {result?.total === 0 && <p style={{ color: 'var(--t-muted)', fontSize: 13 }}>No possible duplicates found.</p>}

      {result?.items.map((pair) => {
        const key = pair.a.personKey + pair.b.personKey;
        return (
          <div className="card" key={key}>
            <span className="eyebrow">{WHY[pair.reason]}</span>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '10px 0 14px' }}>
              <Person person={pair.a} busy={busy === key} onKeep={() => keep(pair, pair.a, pair.b)} />
              <Person person={pair.b} busy={busy === key} onKeep={() => keep(pair, pair.b, pair.a)} />
            </div>
            <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 14 }}>
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy === key} onClick={() => void decide(pair, () => api.markCitizensDistinct(pair.a.personKey, pair.b.personKey))}>
                Different people
              </button>
            </div>
          </div>
        );
      })}

      {result && <Pagination page={result.page} pageSize={result.pageSize} total={result.total} onPageChange={setPage} />}
    </section>
  );
}

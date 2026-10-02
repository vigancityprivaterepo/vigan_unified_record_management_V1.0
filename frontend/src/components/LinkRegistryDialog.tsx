import { useEffect, useState } from 'react';
import { LoadError } from '@/components/LoadError';
import { Modal } from '@/components/Modal';
import { Pagination } from '@/components/Pagination';
import { api, ApiError, type OfficeModule, type RegistryLinks } from '@/lib/api';

// Link saved records (name only) to registry citizens, for programs where
// the link is optional (backend services/registryLinking.ts). Only exact
// name + same birthdate may be linked in bulk; every other suggestion is
// confirmed one by one after comparing the details side by side.
export function LinkRegistryDialog({ officeId, module, onClose, onLinked }: {
  officeId: string; module: OfficeModule; onClose: () => void; onLinked: () => void;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RegistryLinks | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setError(null);
    api.registryLinks(officeId, module.id, page).then(setData).catch((err) => { setData(null); setError(err); });
  }, [officeId, module.id, page, attempt]);
  const reload = () => setAttempt((n) => n + 1);

  async function linkSure() {
    setBusy('sure');
    setMessage(null);
    try {
      const r = await api.linkRegistrySure(officeId, module.id);
      setMessage({ kind: 'ok', text: `${r.linked} ${r.linked === 1 ? 'record' : 'records'} linked.` });
      onLinked();
      reload();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : 'Linking failed' });
    } finally {
      setBusy(null);
    }
  }

  async function link(recordId: string, personKey: string) {
    setBusy(recordId);
    setMessage(null);
    try {
      await api.linkRegistryRecord(officeId, module.id, recordId, personKey);
      onLinked();
      reload();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : 'Linking failed' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title="Link to the City Citizen Registry" eyebrow={module.name} wide onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error != null && <LoadError what="possible matches" error={error} onRetry={reload} />}
        {error == null && !data && <span className="spinner" />}
        {data && (
          <>
            <p style={{ margin: 0 }}>
              <strong>{data.unlinked.toLocaleString()}</strong> {module.name} {data.unlinked === 1 ? 'record names' : 'records name'} a person not linked to the registry.{' '}
              {data.withCandidates === 0
                ? 'None of them matches a registry citizen yet. More will match as offices register or import their citizens.'
                : `${data.withCandidates.toLocaleString()} have a possible match below.`}
            </p>
            {data.sure > 0 && (
              <div className="lr-sure">
                <span><strong>{data.sure.toLocaleString()}</strong> {data.sure === 1 ? 'match is' : 'matches are'} certain: same name and same birthdate, and only one such citizen.</span>
                <button type="button" className="btn btn--primary" disabled={busy !== null} onClick={linkSure}>{busy === 'sure' ? 'Linking...' : `Link ${data.sure.toLocaleString()} certain ${data.sure === 1 ? 'match' : 'matches'}`}</button>
              </div>
            )}
            {message && <div className={`alert ${message.kind === 'ok' ? 'success' : 'danger'}`}><div className="body">{message.text}</div></div>}
            {data.items.length > 0 && (
              <p className="ws-kpi-sub" style={{ margin: 0 }}>A name alone does not prove it is the same person. Compare birthdate and barangay, and link only when sure.</p>
            )}
            <div className="lr-list">
              {data.items.map((row) => (
                <div key={row.recordId} className="lr-row">
                  <div className="lr-rec">
                    <div style={{ fontWeight: 600 }}>{row.name}</div>
                    <div className="lr-meta">{[row.context, row.bdate ? `born ${row.bdate}` : 'no birthdate on this record'].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className="lr-cands">
                    {row.candidates.map((c) => (
                      <div key={c.personKey} className="lr-cand">
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>
                            {c.name}
                            {c.exactName && c.sameBirthdate ? <span className="lr-tag is-sure">Same name and birthdate</span>
                              : c.exactName ? <span className="lr-tag">Same name</span>
                              : <span className="lr-tag">Similar name ({Math.round(c.similarity * 100)}%)</span>}
                          </div>
                          <div className="lr-meta">{[c.bdate ? `born ${c.bdate}` : 'no birthdate', c.barangay ?? 'no barangay', c.programs.length ? `in ${c.programs.slice(0, 3).join(', ')}${c.programs.length > 3 ? ` and ${c.programs.length - 3} more` : ''}` : 'in no program'].join(' · ')}</div>
                        </div>
                        <button type="button" className="btn btn--ghost" disabled={busy !== null} onClick={() => link(row.recordId, c.personKey)}>
                          {busy === row.recordId ? 'Linking...' : 'Same person: link'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {data.withCandidates > data.pageSize && <Pagination page={data.page} pageSize={data.pageSize} total={data.withCandidates} onPageChange={setPage} />}
            <p className="ws-kpi-sub" style={{ margin: 0 }}>Each link is recorded in the audit log. The name the office recorded is kept on the record.</p>
          </>
        )}
      </div>
    </Modal>
  );
}

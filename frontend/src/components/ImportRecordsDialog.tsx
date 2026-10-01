import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { api, ApiError, type ImportRowResult, type OfficeFormField, type OfficeModule } from '@/lib/api';
import { downloadCsv, parseCsv } from '@/lib/csvParse';

// Bulk import for one program: choose a CSV, match its columns to the form,
// check every row (nothing saved), then import. Every row goes through the
// same checks as the registration form (backend services/officeImport.ts).

const CHUNK = 500;
type Target = { id: string; label: string; required: boolean; kind: 'core' | 'field'; key: string; hint?: string; aliases: string[] };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function targetsFor(module: OfficeModule, fields: OfficeFormField[]): Target[] {
  const t: Target[] = [];
  const core = (key: string, label: string, required: boolean, aliases: string[], hint?: string) =>
    t.push({ id: `core.${key}`, kind: 'core', key, label, required, aliases, hint });
  if (module.collectPersonInfo) {
    core('lname', 'Last name', true, ['last name', 'surname', 'lastname', 'lname', 'family name', 'apelyido']);
    core('fname', 'First name', true, ['first name', 'given name', 'firstname', 'fname', 'pangalan']);
    core('mname', 'Middle name', false, ['middle name', 'middlename', 'mname', 'mi', 'middle initial']);
    core('bdate', 'Birthdate', true, ['birthdate', 'birth date', 'date of birth', 'dob', 'birthday', 'bdate', 'kaarawan'], 'YYYY-MM-DD or month/day/year');
    if (module.collectSex) core('sex', 'Sex', false, ['sex', 'gender', 'kasarian'], 'M or F');
    if (module.collectCivilStatus) core('civilStatus', 'Civil status', false, ['civil status', 'civilstatus']);
    if (module.collectStreet) core('street', 'Street', false, ['street', 'address', 'purok', 'sitio', 'street address']);
    if (module.collectBarangay) core('barangay', 'Barangay', false, ['barangay', 'brgy', 'barangay name']);
  }
  for (const f of fields) {
    if (f.fieldType === 'FILE') continue;
    const hint = f.fieldType === 'DATE' ? 'YYYY-MM-DD or month/day/year'
      : f.fieldType === 'BOOLEAN' ? 'yes or no'
      : f.fieldType === 'MULTISELECT' ? `one or more of: ${f.options.join(', ')} (separate with ;)`
      : f.fieldType === 'SELECT' && f.options.length ? `one of: ${f.options.join(', ')}` : undefined;
    t.push({ id: `field.${f.key}`, kind: 'field', key: f.key, label: f.label, required: f.isRequired, aliases: [f.label, f.key], hint });
  }
  return t;
}

function guess(targets: Target[], headers: string[]): Record<string, number> {
  const used = new Set<number>();
  const map: Record<string, number> = {};
  for (const t of targets) {
    const idx = headers.findIndex((h, i) => !used.has(i) && t.aliases.some((a) => norm(a) === norm(h)));
    if (idx >= 0) { map[t.id] = idx; used.add(idx); }
  }
  return map;
}

const OUTCOME_LABEL: Record<string, string> = {
  match: 'Will link to a citizen already in the registry',
  new: 'Will add a new citizen to the registry',
  review: 'Will go to duplicate review (a similar citizen exists)',
  record: 'Will be added',
  linked: 'Linked to a citizen already in the registry',
  created: 'Added with a new citizen',
  already_received: 'Refused: already received for this event',
  failed: 'Could not be saved',
  invalid: 'Has problems and will be skipped',
};

export function ImportRecordsDialog({ officeId, module, onClose, onImported }: {
  officeId: string; module: OfficeModule; onClose: () => void; onImported: () => void;
}) {
  const [fields, setFields] = useState<OfficeFormField[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: string[][] } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [step, setStep] = useState<'file' | 'map' | 'check' | 'done'>('file');
  const [results, setResults] = useState<ImportRowResult[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportRowResult[] | null>(null);

  useEffect(() => {
    api.getOfficeModuleFields(officeId, module.id).then(setFields).catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Could not load the form'));
  }, [officeId, module.id]);
  const targets = useMemo(() => (fields ? targetsFor(module, fields) : []), [module, fields]);
  const fileFields = fields?.filter((f) => f.fieldType === 'FILE') ?? [];
  const missingRequired = targets.filter((t) => t.required && mapping[t.id] === undefined);

  async function pickFile(f: File | undefined) {
    setFileError(null);
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) {
      setFileError('Choose a CSV file. In Excel: File, Save As, "CSV UTF-8 (Comma delimited)".');
      return;
    }
    const parsed = parseCsv(await f.text());
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setFileError('The file has no rows under its header row.');
      return;
    }
    setFile({ name: f.name, ...parsed });
    setMapping(guess(targets, parsed.headers));
    setStep('map');
  }

  function rowPayload(r: string[]) {
    const core: Record<string, string> = {};
    const flds: Record<string, string> = {};
    for (const t of targets) {
      const i = mapping[t.id];
      if (i === undefined) continue;
      const v = r[i] ?? '';
      if (v === '') continue;
      if (t.kind === 'core') core[t.key] = v; else flds[t.key] = v;
    }
    return { core, fields: flds };
  }

  async function run(dryRun: boolean) {
    if (!file) return;
    setRunError(null);
    setProgress({ done: 0, total: file.rows.length });
    const all: ImportRowResult[] = [];
    let batchId: string | undefined;
    try {
      for (let start = 0; start < file.rows.length; start += CHUNK) {
        const chunk = file.rows.slice(start, start + CHUNK);
        const res = await api.importRecords(officeId, module.id, { dryRun, batchId, fileName: file.name, rows: chunk.map(rowPayload) });
        batchId = res.batchId;
        all.push(...res.results.map((r) => ({ ...r, row: r.row + start })));
        setProgress({ done: Math.min(start + CHUNK, file.rows.length), total: file.rows.length });
      }
      if (dryRun) { setResults(all); setStep('check'); } else { setImported(all); setStep('done'); onImported(); }
    } catch (err) {
      setRunError(`${err instanceof ApiError ? err.message : 'The server could not be reached'}. ${dryRun ? '' : `${all.length} of ${file.rows.length} rows were processed before this; check the records list before importing again.`}`);
      if (!dryRun && all.length) { setImported(all); setStep('done'); onImported(); }
    } finally {
      setProgress(null);
    }
  }

  function downloadTemplate() {
    downloadCsv(`${module.slug}-import-template.csv`, [targets.map((t) => t.label)]);
  }
  function downloadProblems(list: ImportRowResult[]) {
    if (!file) return;
    const bad = list.filter((r) => r.errors?.length);
    downloadCsv(`${module.slug}-rows-to-fix.csv`, [
      ['Spreadsheet row', ...file.headers, 'Problems'],
      ...bad.map((r) => [String(r.row + 2), ...(file.rows[r.row] ?? []), (r.errors ?? []).join(' | ')]),
    ]);
  }

  const counts = (list: ImportRowResult[]) => {
    const c: Record<string, number> = {};
    for (const r of list) c[r.outcome] = (c[r.outcome] ?? 0) + 1;
    return c;
  };

  return (
    <Modal title={`Import ${module.name} records`} eyebrow="Import from a spreadsheet" wide onClose={progress ? () => undefined : onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ol className="imp-steps" aria-label="Steps">
          {(['Choose file', 'Match columns', 'Check', 'Import'] as const).map((label, i) => {
            const at = ['file', 'map', 'check', 'done'].indexOf(step);
            return <li key={label} className={i === at ? 'is-on' : i < at ? 'is-done' : ''}>{i < at && <Icon name="check" size={13} strokeWidth={2.6} />}{label}</li>;
          })}
        </ol>
        {loadError && <div className="alert danger"><div className="body">{loadError}</div></div>}
        {!fields && !loadError && <span className="spinner" />}

        {fields && step === 'file' && (
          <>
            <p style={{ margin: 0 }}>
              Use a CSV file with one record per row and column names in the first row. From Excel or Google Sheets, save or download it as <strong>CSV</strong>.
              Nothing is saved until the last step.
            </p>
            <label className="imp-drop">
              <Icon name="download" size={22} />
              <span><strong>Choose a CSV file</strong></span>
              <input type="file" accept=".csv,text/csv" onChange={(e) => pickFile(e.target.files?.[0])} />
            </label>
            {fileError && <div className="alert danger"><div className="body">{fileError}</div></div>}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--ghost" onClick={downloadTemplate}>Download a blank template</button>
              <span className="ws-kpi-sub">with this program&apos;s columns: {targets.map((t) => t.label).join(', ')}</span>
            </div>
            {fileFields.length > 0 && (
              <p className="ws-note">Uploaded documents ({fileFields.map((f) => f.label).join(', ')}) can&apos;t be imported. Add them to each record afterwards.</p>
            )}
          </>
        )}

        {fields && step === 'map' && file && (
          <>
            <p style={{ margin: 0 }}><strong>{file.name}</strong>: {file.rows.length.toLocaleString()} rows. Match each item to a column in your file. Columns were matched by name where possible; check them.</p>
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th>Form item</th><th>Column in your file</th><th>First row</th></tr></thead>
                <tbody>
                  {targets.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{t.label}{t.required && <span style={{ color: 'var(--danger)' }}> (required)</span>}</div>
                        {t.hint && <div style={{ fontSize: 13, color: 'var(--t-muted)' }}>{t.hint}</div>}
                      </td>
                      <td>
                        <select className="select" aria-label={`Column for ${t.label}`} value={mapping[t.id] ?? ''}
                          onChange={(e) => setMapping((m) => { const n = { ...m }; if (e.target.value === '') delete n[t.id]; else n[t.id] = Number(e.target.value); return n; })}>
                          <option value="">Not in my file</option>
                          {file.headers.map((h, i) => <option key={`${h}-${i}`} value={i}>{h || `Column ${i + 1}`}</option>)}
                        </select>
                      </td>
                      <td style={{ color: 'var(--t-muted)' }}>{mapping[t.id] !== undefined ? file.rows[0]?.[mapping[t.id]!] ?? '' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {missingRequired.length > 0 && <p className="field-error" style={{ margin: 0 }}>Choose a column for: {missingRequired.map((t) => t.label).join(', ')}.</p>}
            {runError && <div className="alert danger"><div className="body">{runError}</div></div>}
            <div className="form-actions">
              <button type="button" className="btn btn--primary" disabled={missingRequired.length > 0 || !!progress} onClick={() => run(true)}>
                {progress ? `Checking ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}...` : 'Check rows'}
              </button>
              <button type="button" className="btn btn--ghost" disabled={!!progress} onClick={() => setStep('file')}>Choose another file</button>
            </div>
          </>
        )}

        {step === 'check' && results && file && (() => {
          const c = counts(results);
          const ok = results.length - (c.invalid ?? 0);
          return (
            <>
              <p style={{ margin: 0 }}>Checked {results.length.toLocaleString()} rows. Nothing has been saved yet.</p>
              <SummaryList counts={c} />
              {(c.invalid ?? 0) > 0 && <ProblemList results={results} onDownload={() => downloadProblems(results)} />}
              {(c.review ?? 0) > 0 && <p className="ws-note">Rows that go to duplicate review are not added until an administrator decides, in Duplicate review.</p>}
              {runError && <div className="alert danger"><div className="body">{runError}</div></div>}
              <div className="form-actions">
                <button type="button" className="btn btn--primary" disabled={ok === 0 || !!progress} onClick={() => run(false)}>
                  {progress ? `Importing ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}...` : `Import ${ok.toLocaleString()} ${ok === 1 ? 'row' : 'rows'}`}
                </button>
                <button type="button" className="btn btn--ghost" disabled={!!progress} onClick={() => setStep('map')}>Back to columns</button>
              </div>
            </>
          );
        })()}

        {step === 'done' && imported && (
          <>
            <p style={{ margin: 0 }}><strong>Import finished.</strong> Each saved record is in the audit log, with this file&apos;s name.</p>
            {runError && <div className="alert danger"><div className="body">{runError}</div></div>}
            <SummaryList counts={counts(imported)} />
            {imported.some((r) => r.errors?.length) && <ProblemList results={imported} onDownload={() => downloadProblems(imported)} />}
            <div className="form-actions"><button type="button" className="btn btn--primary" onClick={onClose}>Done</button></div>
          </>
        )}
      </div>
    </Modal>
  );
}

function SummaryList({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="imp-summary">
      {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
        <div key={k} className={k === 'invalid' || k === 'failed' || k === 'already_received' ? 'is-bad' : ''}>
          <strong>{n.toLocaleString()}</strong> {OUTCOME_LABEL[k] ?? k}
        </div>
      ))}
    </div>
  );
}

function ProblemList({ results, onDownload }: { results: ImportRowResult[]; onDownload: () => void }) {
  const bad = results.filter((r) => r.errors?.length);
  return (
    <div className="ws-stack-y" style={{ gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <strong style={{ flex: 1 }}>Rows to fix</strong>
        <button type="button" className="btn btn--ghost" onClick={onDownload}><Icon name="download" size={16} /> Download rows to fix</button>
      </div>
      <div className="table-scroll" style={{ maxHeight: 260, overflow: 'auto' }}>
        <table className="table">
          <thead><tr><th>Row</th><th>Name</th><th>Problem</th></tr></thead>
          <tbody>
            {bad.slice(0, 100).map((r) => (
              <tr key={r.row}><td>{r.row + 2}</td><td>{r.name ?? ''}</td><td>{(r.errors ?? []).join('; ')}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {bad.length > 100 && <span className="ws-kpi-sub">Showing 100 of {bad.length.toLocaleString()}; download the file for all of them.</span>}
    </div>
  );
}

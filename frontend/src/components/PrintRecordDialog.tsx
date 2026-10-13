import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '@/components/Modal';
import logoUrl from '@/logo.png';
import { api, ApiError, type OfficeFormField, type OfficeModule, type PrintableRecord, type PrintKind } from '@/lib/api';

// Prints a certification, or the program's ID card, from one saved record.
// The server checks the record (linked to the registry, not archived, the
// person not deceased) and logs the printing before anything is drawn.
//
// The ID card is offered for programs that record an ID number (a field
// whose key ends in "_id_no": OSCA, PWD, Solo Parent). Its layout is a plain
// card of standard size; an office that must follow a national template
// (NCDA for PWD, for example) should treat this as a working copy.

const CARD_TITLE: Record<string, string> = {
  senior_citizen: 'SENIOR CITIZEN ID',
  senior: 'SENIOR CITIZEN ID',
  pwd: 'PERSON WITH DISABILITY ID',
  solo_parent: 'SOLO PARENT ID',
};

const longDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00`).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : '';

function shown(value: unknown, type: string): string {
  if (value === null || value === undefined || value === '') return '';
  if (value === true || value === 'true') return 'Yes';
  if (value === false || value === 'false') return 'No';
  if (Array.isArray(value)) return value.join(', ');
  if (type === 'DATE' && typeof value === 'string') return longDate(value);
  return String(value);
}

function ageOf(bdate: string | null): number | null {
  if (!bdate) return null;
  const b = new Date(`${bdate}T00:00`);
  const now = new Date();
  const had = now.getMonth() > b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() >= b.getDate());
  return now.getFullYear() - b.getFullYear() - (had ? 0 : 1);
}

const fullName = (p: PrintableRecord['person']) => [p.fname, p.mname, p.lname].filter(Boolean).join(' ');
const address = (p: PrintableRecord['person']) => [p.street, p.barangay, 'Vigan City, Ilocos Sur'].filter(Boolean).join(', ');

// Remembered on this computer per office, so staff type the signatory once.
function useRemembered(key: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => {
    try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
  });
  return [value, (v) => {
    setValue(v);
    try { localStorage.setItem(key, v); } catch { /* storage disabled */ }
  }];
}

export function PrintRecordDialog({ officeId, officeModule, fields, recordId, personName, onClose }: {
  officeId: string; officeModule: OfficeModule; fields: OfficeFormField[]; recordId: string; personName: string; onClose: () => void;
}) {
  const idField = fields.find((f) => /_id_no$/.test(f.key));
  const [kind, setKind] = useState<PrintKind>('certificate');
  const [signatory, setSignatory] = useRemembered(`vigan-print-signatory:${officeId}`);
  const [position, setPosition] = useRemembered(`vigan-print-position:${officeId}`);
  const [purpose, setPurpose] = useState('whatever legal purpose it may serve');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<PrintableRecord | null>(null);

  async function handlePrint(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSheet(await api.printRecord(officeId, officeModule.id, recordId, kind));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not prepare the document');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Print certificate or ID" eyebrow={`${officeModule.name} · ${personName}`} onClose={onClose}>
      <form onSubmit={handlePrint} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="field">
          <span className="field-label">What to print</span>
          <div className="ws-seg" role="group" aria-label="What to print" style={{ alignSelf: 'flex-start' }}>
            <button type="button" className={kind === 'certificate' ? 'is-on' : ''} onClick={() => setKind('certificate')}>Certification</button>
            {idField && <button type="button" className={kind === 'id_card' ? 'is-on' : ''} onClick={() => setKind('id_card')}>ID card</button>}
          </div>
          {!idField && <p className="ws-kpi-sub" style={{ margin: '6px 0 0' }}>An ID card is offered for programs that record an ID number.</p>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div className="field">
            <label className="field-label" htmlFor="pr-signatory">Signed by</label>
            <input id="pr-signatory" className="input" value={signatory} onChange={(e) => setSignatory(e.target.value)} placeholder="Name of the office head" maxLength={120} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pr-position">Position</label>
            <input id="pr-position" className="input" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="City Social Welfare and Development Officer" maxLength={120} />
          </div>
        </div>
        {kind === 'certificate' && (
          <div className="field">
            <label className="field-label" htmlFor="pr-purpose">Issued for</label>
            <input id="pr-purpose" className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={200} />
          </div>
        )}
        <p className="ws-kpi-sub" style={{ margin: 0 }}>
          Printing is recorded in the audit log with your name. The signatory is remembered on this computer.
          {kind === 'id_card' && ' The card is standard size (85.6 by 54 mm), front and back side by side: print at 100% scale, cut and fold.'}
        </p>
        {error && <div className="alert danger"><div className="body">{error}</div></div>}
        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Preparing...' : 'Print'}</button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>
        </div>
      </form>
      {sheet && <Sheet sheet={sheet} signatory={signatory} position={position} purpose={purpose} onDone={() => setSheet(null)} />}
    </Modal>
  );
}

// Rendered outside the app root and shown only by @media print
// (workspace.css, shared with the disaster lists), then removed.
function Sheet({ sheet, signatory, position, purpose, onDone }: { sheet: PrintableRecord; signatory: string; position: string; purpose: string; onDone: () => void }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const after = () => done.current();
    window.addEventListener('afterprint', after);
    const t = window.setTimeout(() => window.print(), 80);
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', after); };
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const p = sheet.person;
  const age = ageOf(p.bdate);
  const filled = sheet.fields.map((f) => ({ ...f, text: shown(sheet.record.values[f.key], f.fieldType) })).filter((f) => f.text !== '');
  const reference = `${sheet.record.id.slice(0, 8).toUpperCase()}-${today.replace(/-/g, '')}`;
  const sign = (
    <div className="pr-sign">
      <div className="pr-sign-line">{signatory.toUpperCase()}</div>
      <div>{position || `Head, ${sheet.office.name}`}</div>
    </div>
  );

  return createPortal(
    <div className="dl-print">
      {sheet.record.sample && <div className="pr-sample">SAMPLE DATA. NOT A VALID DOCUMENT.</div>}
      {sheet.kind === 'certificate' ? (
        <div className="pr-cert">
          <div className="pr-cert-head">
            <img src={logoUrl} alt="" />
            <div>
              Republic of the Philippines<br />Province of Ilocos Sur<br /><strong>CITY OF VIGAN</strong>{sheet.office.name}
            </div>
            <span style={{ width: '22mm' }} />
          </div>
          <h1>CERTIFICATION</h1>
          <p>TO WHOM IT MAY CONCERN:</p>
          <p className="pr-indent">
            This is to certify that <strong>{fullName(p).toUpperCase()}</strong>
            {age != null ? `, ${age} years old` : ''}{p.civilStatus ? `, ${p.civilStatus.toLowerCase()}` : ''}, a resident of {address(p)}, is registered
            with this office under the <strong>{sheet.program.name}</strong> program since {longDate(sheet.record.addedOn)}, with the following on record:
          </p>
          <table>
            <tbody>
              {p.bdate && <tr><td>Date of birth</td><td>{longDate(p.bdate)}</td></tr>}
              {p.sex && <tr><td>Sex</td><td>{p.sex === 'M' ? 'Male' : p.sex === 'F' ? 'Female' : p.sex}</td></tr>}
              {filled.map((f) => <tr key={f.key}><td>{f.label}</td><td>{f.text}</td></tr>)}
            </tbody>
          </table>
          <p className="pr-indent">
            This certification is issued upon the request of the above-named person for {purpose.trim() || 'whatever legal purpose it may serve'}.
          </p>
          <p className="pr-indent">Issued this {longDate(today)} at Vigan City, Ilocos Sur, Philippines.</p>
          {sign}
          <div className="pr-foot">
            Reference no. {reference}{sheet.printedBy ? ` · Prepared by ${sheet.printedBy}` : ''} · Not valid without the signature and seal of the office.
          </div>
        </div>
      ) : (
        <div className="pr-cards">
          <div className="pr-card">
            {sheet.record.sample && <div className="pr-card-stamp">SAMPLE</div>}
            <div className="pr-card-head">
              <img src={logoUrl} alt="" />
              <div>Republic of the Philippines · City of Vigan<br />{sheet.office.name}<strong>{CARD_TITLE[sheet.program.slug] ?? `${sheet.program.name.toUpperCase()} ID`}</strong></div>
            </div>
            <div className="pr-card-body">
              <div className="pr-card-photo">Photo</div>
              <div style={{ minWidth: 0 }}>
                <div className="pr-card-name">{`${p.lname}, ${p.fname}${p.mname ? ` ${p.mname.charAt(0)}.` : ''}`.toUpperCase()}</div>
                <dl>
                  {sheet.fields.filter((f) => /_id_no$/.test(f.key)).slice(0, 1).map((f) => <Row key={f.key} label="ID No." value={shown(sheet.record.values[f.key], f.fieldType)} />)}
                  <Row label="Born" value={longDate(p.bdate)} />
                  <Row label="Sex" value={p.sex === 'M' ? 'Male' : p.sex === 'F' ? 'Female' : p.sex ?? ''} />
                  <Row label="Address" value={[p.street, p.barangay].filter(Boolean).join(', ')} />
                </dl>
              </div>
            </div>
            <div className="pr-card-sig"><span>Signature of holder</span><span>{signatory ? signatory.toUpperCase() : 'Issuing officer'}</span></div>
          </div>
          <div className="pr-card pr-card-back">
            {sheet.record.sample && <div className="pr-card-stamp">SAMPLE</div>}
            <dl style={{ marginBottom: '1.5mm' }}>
              {filled.filter((f) => !/_id_no$/.test(f.key)).slice(0, 5).map((f) => <Row key={f.key} label={f.label} value={f.text} />)}
              <Row label="Issued" value={longDate(today)} />
            </dl>
            <p>This card is not transferable. It is issued by the {sheet.office.name}, City of Vigan, to the person named on its face.</p>
            <p>If found, please return it to the {sheet.office.shortName || sheet.office.name}, Vigan City Hall.</p>
            <div className="pr-card-sig"><span>{position || `Head, ${sheet.office.shortName || sheet.office.name}`}</span><span>Ref. {reference}</span></div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (<><dt>{label}</dt><dd>{value}</dd></>);
}

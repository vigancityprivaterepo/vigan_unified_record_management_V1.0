import { useEffect, useState } from 'react';
import { CitizenPicker } from '@/components/CitizenPicker';
import {
  DynamicExtraFields,
  defaultFieldValues,
  toSubmitValues,
  type FieldValues,
  type FileValues,
} from '@/components/DynamicExtraFields';
import { Icon } from '@/components/Icon';
import { IntakeResultCard } from '@/components/IntakeResultCard';
import { PersonCoreFields } from '@/components/PersonCoreFields';
import {
  api,
  ApiError,
  type CitizenListItem,
  type IntakeResult,
  type OfficeFormField,
  type OfficeModule,
  type PersonCore,
} from '@/lib/api';
import { initials, moduleIcon } from '@/lib/officeTheme';

const EMPTY_CORE: PersonCore = { lname: '', fname: '', mname: '', bdate: '', sex: '', civilStatus: '', street: '', brgyCode: '' };

// Same submission contract as before (PersonCoreFields + DynamicExtraFields
// -> api.submitOfficeRecord, backend resolvePerson() still decides
// created/matched/needs_review). What changed is the flow: a guided
// Find -> Details -> Review sequence, with a registry search up front so
// staff pick an existing person instead of retyping (and misspelling) them.
export function DynamicOfficeIntakePage({ officeId, officeName, module: officeModule, onViewRecords }: {
  officeId: string;
  officeName: string;
  module: OfficeModule;
  onViewRecords?: () => void;
}) {
  const [fields, setFields] = useState<OfficeFormField[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState(0);
  const [lookup, setLookup] = useState('');
  const [matches, setMatches] = useState<CitizenListItem[] | null>(null);
  const [matchError, setMatchError] = useState(false);
  const [picked, setPicked] = useState<CitizenListItem | null>(null);
  const [isNewPerson, setIsNewPerson] = useState(false);

  const [core, setCore] = useState<PersonCore>(EMPTY_CORE);
  const [linkToCitizen, setLinkToCitizen] = useState(true);
  const [showHouseholdLink, setShowHouseholdLink] = useState(false);
  const [householdParent, setHouseholdParent] = useState<CitizenListItem | null>(null);
  const [householdRelation, setHouseholdRelation] = useState('');
  const [values, setValues] = useState<FieldValues>({});
  const [fileValues, setFileValues] = useState<FileValues>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IntakeResult | null>(null);

  useEffect(() => {
    setFields(null);
    setLoadError(null);
    api
      .getOfficeModuleFields(officeId, officeModule.id)
      .then((f) => { setFields(f); setValues(defaultFieldValues(f)); setFileValues({}); })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Failed to load this module’s form'));
  }, [officeId, officeModule.id]);

  // Debounced registry search (same endpoint the household picker uses).
  useEffect(() => {
    const q = lookup.trim();
    if (q.length < 2) { setMatches(null); setMatchError(false); return; }
    const t = setTimeout(() => {
      // A failed search must not read as "no one matches" -- that would push
      // staff to register a duplicate.
      api
        .officeCitizenSearch(officeId, q)
        .then((rows) => { setMatches(rows.slice(0, 6)); setMatchError(false); })
        .catch(() => { setMatches(null); setMatchError(true); });
    }, 250);
    return () => clearTimeout(t);
  }, [lookup, officeId]);

  const collectsPerson = officeModule.collectPersonInfo;
  const stepNames = collectsPerson ? ['Find the person', `${officeModule.name} details`, 'Review & save'] : [`${officeModule.name} details`, 'Review & save'];
  const stepKind = collectsPerson ? (['find', 'details', 'review'] as const)[step] : (['details', 'review'] as const)[step];
  const willLinkToCitizen = collectsPerson && (officeModule.requiresCitizenLink || linkToCitizen);
  const nothingToSubmit = fields !== null && !collectsPerson && fields.length === 0;
  const coreReady = !collectsPerson || (core.lname.trim() && core.fname.trim() && core.bdate);

  function pick(c: CitizenListItem) {
    setPicked(c);
    setIsNewPerson(false);
    setCore((prev) => ({ ...prev, lname: c.personLname, fname: c.personFname, mname: c.personMname ?? '', bdate: c.personBdate ? c.personBdate.slice(0, 10) : '' }));
  }

  function startOver() {
    setStep(0); setLookup(''); setMatches(null); setPicked(null); setIsNewPerson(false);
    setCore(EMPTY_CORE); setLinkToCitizen(true); setShowHouseholdLink(false); setHouseholdParent(null); setHouseholdRelation('');
    setFileValues({}); if (fields) setValues(defaultFieldValues(fields));
    setResult(null); setError(null);
  }

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.submitOfficeRecord(
        officeId,
        officeModule.id,
        collectsPerson
          ? {
              ...core,
              mname: core.mname || undefined,
              sex: core.sex || undefined,
              civilStatus: core.civilStatus || undefined,
              street: core.street || undefined,
              brgyCode: core.brgyCode || undefined,
              ...(officeModule.requiresCitizenLink ? {} : { linkToCitizen }),
              ...(willLinkToCitizen && householdParent ? { householdParentKey: householdParent.personKey, householdRelation: householdRelation || undefined } : {}),
            }
          : undefined,
        toSubmitValues(fields ?? [], values),
        fileValues,
      );
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  const canContinue = stepKind === 'find' ? (picked !== null || isNewPerson) && !!coreReady : stepKind === 'details' ? !nothingToSubmit : !submitting;
  const personLine = picked ? `${picked.personFname} ${picked.personLname}` : [core.fname, core.lname].filter(Boolean).join(' ') || 'New person';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="ws-page-head">
        <div className="ws-tile ws-tile--lg"><Icon name={moduleIcon(officeModule)} size={26} strokeWidth={1.8} /></div>
        <div className="grow"><h1>New {officeModule.name.toLowerCase()} registration</h1><p>{officeName}</p></div>
        {onViewRecords && <button className="btn btn--ghost btn--lg" onClick={onViewRecords}>Cancel</button>}
      </div>

      <div className="ws-card ws-stepper">
        {stepNames.map((n, i) => (
          <span key={n} style={{ display: 'contents' }}>
            <span className={`ws-step${i === step && !result ? ' is-current' : ''}${i < step || result ? ' is-done' : ''}`}>
              <span className="ws-step-n">{i < step || result ? <Icon name="check" size={13} strokeWidth={2.6} /> : i + 1}</span>{n}{(i < step || result) && <span className="sr-only"> (done)</span>}
            </span>
            {i < stepNames.length - 1 && <span className="ws-step-line" />}
          </span>
        ))}
      </div>

      {loadError && <div className="alert danger"><div className="body">{loadError}</div></div>}
      {fields === null && !loadError && <span className="spinner" />}

      {fields !== null && result && (
        <div className="ws-card ws-card--pad" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <IntakeResultCard result={result} />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn--primary btn--lg" onClick={startOver}>Register another</button>
            {onViewRecords && <button className="btn btn--ghost btn--lg" onClick={onViewRecords}>View records</button>}
          </div>
        </div>
      )}

      {fields !== null && !result && (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '2 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {stepKind === 'find' && (
              <>
                <section className="ws-card ws-card--pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 19 }}>Search the City Citizen Registry</h2>
                  </div>
                  <label className="input" style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52, borderColor: 'var(--primary)', borderWidth: 1.5 }}>
                    <Icon name="search" size={20} />
                    <input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="Type a last name, e.g. Domingo" style={{ border: 0, outline: 'none', flex: 1, fontSize: 17, background: 'transparent' }} autoFocus />
                  </label>
                  {matchError && <p className="field-error" style={{ margin: 0 }}>The registry search failed, so it's not known whether this person is already registered. Try again before registering a new person.</p>}
                  {matches?.length === 0 && <p style={{ margin: 0, fontSize: 14, color: 'var(--t-muted)' }}>No one matches “{lookup}”. Check the spelling, or register a new person below.</p>}
                  {matches?.map((c) => {
                    const on = picked?.personKey === c.personKey;
                    return (
                      <div key={c.personKey} className={`ws-match${on ? ' is-picked' : ''}`}>
                        <div className="ws-avatar">{initials(`${c.personFname} ${c.personLname}`)}</div>
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <div style={{ fontWeight: 600, fontSize: 16 }}>{c.personFname} {c.personMname ? `${c.personMname} ` : ''}{c.personLname}</div>
                          <div style={{ fontSize: 13, color: 'var(--t-muted)' }}>{[c.personBdate ? `Born ${new Date(c.personBdate).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })}` : null, c.barangay?.name].filter(Boolean).join(' · ')}</div>
                        </div>
                        <button type="button" className={`btn ${on ? 'btn--primary' : 'btn--ghost'}`} onClick={() => (on ? setPicked(null) : pick(c))}>{on ? <><Icon name="check" size={14} /> Selected</> : 'Select'}</button>
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 6, borderTop: '1px dashed var(--border)', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, color: 'var(--t-muted)', flex: 1 }}>Not in the registry yet?</span>
                    <button type="button" className="btn btn--ghost" onClick={() => { setPicked(null); setIsNewPerson(true); setCore(EMPTY_CORE); }}>Register as a new person</button>
                  </div>
                </section>

                {(picked || isNewPerson) && (
                  <section className="ws-card ws-card--pad" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <h2 style={{ margin: 0, fontSize: 19 }}>{picked ? 'Confirm their details' : 'New person'}</h2>
                    <PersonCoreFields
                      value={core}
                      onChange={(patch) => setCore((c) => ({ ...c, ...patch }))}
                      show={{ sex: officeModule.collectSex, civilStatus: officeModule.collectCivilStatus, street: officeModule.collectStreet, barangay: officeModule.collectBarangay }}
                    />
                    {!officeModule.requiresCitizenLink && (
                      <label className="check">
                        <input type="checkbox" checked={linkToCitizen} onChange={(e) => setLinkToCitizen(e.target.checked)} />
                        <span className="box" />
                        Link to a Citizen record (uncheck if this person doesn’t reside in Vigan)
                      </label>
                    )}
                    {willLinkToCitizen && (
                      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 14 }}>
                        <label className="check">
                          <input type="checkbox" checked={showHouseholdLink} onChange={(e) => { setShowHouseholdLink(e.target.checked); if (!e.target.checked) { setHouseholdParent(null); setHouseholdRelation(''); } }} />
                          <span className="box" />
                          Add this person to an existing household
                        </label>
                        {showHouseholdLink && (
                          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {householdParent ? (
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14 }}>
                                <span>Household head: <strong>{householdParent.personLname}, {householdParent.personFname}</strong></span>
                                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setHouseholdParent(null)}>Change</button>
                              </div>
                            ) : (
                              <CitizenPicker search={(q) => api.officeCitizenSearch(officeId, q)} onSelect={setHouseholdParent} placeholder="Search for the head of household..." />
                            )}
                            {householdParent && (
                              <div className="field">
                                <label className="field-label" htmlFor="household-relation">Relation to head</label>
                                <input id="household-relation" className="input" placeholder="e.g. Child" value={householdRelation} onChange={(e) => setHouseholdRelation(e.target.value)} />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                )}
              </>
            )}

            {stepKind === 'details' && (
              <section className="ws-card ws-card--pad" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 19 }}>{officeModule.name} details</h2>
                  {collectsPerson && <p style={{ margin: '6px 0 0', color: 'var(--t-muted)', fontSize: 14 }}>For {personLine}</p>}
                </div>
                {fields.length === 0 && (
                  <p style={{ margin: 0, fontSize: 14, color: 'var(--t-muted)' }}>
                    {nothingToSubmit ? 'This module has nothing to fill in yet. An administrator can add fields from Offices.' : 'No extra details needed for this module. Continue to review.'}
                  </p>
                )}
                <DynamicExtraFields
                  fields={fields}
                  values={values}
                  onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
                  fileValues={fileValues}
                  onFileChange={(key, file) => setFileValues((v) => ({ ...v, [key]: file }))}
                />
              </section>
            )}

            {stepKind === 'review' && (
              <section className="ws-card ws-card--pad" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <h2 style={{ margin: 0, fontSize: 19 }}>Check everything before saving</h2>
                {collectsPerson && (
                  <div className="ws-soft" style={{ display: 'flex', gap: 14, alignItems: 'center', padding: 16, borderRadius: 'var(--r-lg)' }}>
                    <Icon name="link" size={22} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 16 }}>{personLine}</div>
                      <div style={{ fontSize: 14 }}>
                        {picked ? 'Existing citizen' : willLinkToCitizen ? 'New person' : 'Not linked'}
                      </div>
                    </div>
                  </div>
                )}
                {fields.length > 0 && (
                  <div className="ws-review-grid">
                    {fields.map((f) => {
                      const v = f.fieldType === 'FILE' ? fileValues[f.key]?.name : values[f.key];
                      const shown = Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v || 'Not provided';
                      return <div key={f.id}><small>{f.label}</small><strong>{shown}</strong></div>;
                    })}
                  </div>
                )}
                {error && <div className="alert danger"><div className="body">{error}</div></div>}
              </section>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {step > 0 && <button type="button" className="btn btn--ghost btn--lg" onClick={() => setStep(step - 1)}><Icon name="arrowL" size={16} />Back</button>}
              <span style={{ flex: 1, fontSize: 14, color: 'var(--t-muted)', minWidth: 160 }}>
                {`Step ${step + 1} of ${stepNames.length}`}
              </span>
              <button
                type="button"
                className="btn btn--primary btn--lg"
                disabled={!canContinue}
                onClick={() => (stepKind === 'review' ? handleSubmit() : setStep(step + 1))}
              >
                {submitting && <span className="spinner sm" />}
                {stepKind === 'review' ? (submitting ? 'Saving…' : 'Save') : 'Continue'}
                {stepKind !== 'review' && <Icon name="arrowR" size={16} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

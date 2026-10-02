// Chosen when a program is created (Create office, Add module): what each
// record is about, which sets collectPersonInfo + requiresCitizenLink.
// Still changeable afterwards under Configure.
export type RecordSubject = 'registry' | 'optional' | 'none';

export const SUBJECT_SETTINGS: Record<RecordSubject, { collectPersonInfo: boolean; requiresCitizenLink: boolean }> = {
  registry: { collectPersonInfo: true, requiresCitizenLink: true },
  optional: { collectPersonInfo: true, requiresCitizenLink: false },
  none: { collectPersonInfo: false, requiresCitizenLink: false },
};

const CHOICES: Array<{ value: RecordSubject; label: string; hint: string }> = [
  { value: 'registry', label: 'A Vigan resident', hint: 'Each record is linked to the City Citizen Registry (e.g. Senior Citizen, PWD, scholars).' },
  { value: 'optional', label: 'A person, registry link optional', hint: 'Staff choose per record whether to link, e.g. births of non-residents, visitors.' },
  { value: 'none', label: 'Not a person', hint: 'Property, businesses, projects, incidents: no name or birthdate asked.' },
];

export function RecordSubjectPicker({ value, onChange, name }: { value: RecordSubject; onChange: (v: RecordSubject) => void; name: string }) {
  return (
    <fieldset className="field span-2" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="field-label">What is each record about?</legend>
      <div className="rs-choices">
        {CHOICES.map((c) => (
          <label key={c.value} className={`rs-choice${value === c.value ? ' is-on' : ''}`}>
            <input type="radio" name={name} value={c.value} checked={value === c.value} onChange={() => onChange(c.value)} />
            <span>
              <strong>{c.label}</strong>
              <span className="rs-hint">{c.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

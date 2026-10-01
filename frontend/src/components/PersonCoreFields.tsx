import { useEffect, useState } from 'react';
import { api, type PersonCore } from '@/lib/api';

// Last/first/middle name and birthdate are always collected -- every
// module's intake, no matter which office -- since resolvePerson() needs
// all four to match/dedupe against the shared Citizen registry. Sex,
// civil status, street, and barangay are the part of this same block a
// module can opt out of (see OfficeModule.collectSex etc.); `show`
// defaults every one of them on so a caller that doesn't pass it still
// gets the original all-fields behavior.
export function PersonCoreFields({
  value,
  onChange,
  show,
}: {
  value: PersonCore;
  onChange: (patch: Partial<PersonCore>) => void;
  show?: { sex?: boolean; civilStatus?: boolean; street?: boolean; barangay?: boolean };
}) {
  const [barangays, setBarangays] = useState<Array<{ code: string; name: string }>>([]);
  const [barangayError, setBarangayError] = useState(false);

  const showSex = show?.sex ?? true;
  const showCivilStatus = show?.civilStatus ?? true;
  const showStreet = show?.street ?? true;
  const showBarangay = show?.barangay ?? true;

  useEffect(() => {
    if (!showBarangay) return;
    setBarangayError(false);
    api.barangays().then(setBarangays).catch(() => {
      setBarangays([]);
      setBarangayError(true);
    });
  }, [showBarangay]);

  return (
    <div className="form-grid">
      <div className="field">
        <label className="field-label" htmlFor="lname">
          Last name
        </label>
        <input
          id="lname"
          className="input"
          required
          value={value.lname}
          onChange={(e) => onChange({ lname: e.target.value })}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="fname">
          First name
        </label>
        <input
          id="fname"
          className="input"
          required
          value={value.fname}
          onChange={(e) => onChange({ fname: e.target.value })}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="mname">
          Middle name
        </label>
        <input
          id="mname"
          className="input"
          value={value.mname ?? ''}
          onChange={(e) => onChange({ mname: e.target.value })}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="bdate">
          Birthdate
        </label>
        <input
          id="bdate"
          type="date"
          className="input"
          required
          value={value.bdate}
          onChange={(e) => onChange({ bdate: e.target.value })}
        />
      </div>
      {showSex && (
        <div className="field">
          <label className="field-label" htmlFor="sex">
            Sex
          </label>
          <select id="sex" className="select" value={value.sex ?? ''} onChange={(e) => onChange({ sex: e.target.value })}>
            <option value="" disabled>
              Select
            </option>
            <option value="M">Male</option>
            <option value="F">Female</option>
          </select>
        </div>
      )}
      {showCivilStatus && (
        <div className="field">
          <label className="field-label" htmlFor="civilStatus">
            Civil status
          </label>
          <input
            id="civilStatus"
            className="input"
            value={value.civilStatus ?? ''}
            onChange={(e) => onChange({ civilStatus: e.target.value })}
          />
        </div>
      )}

      {showStreet && (
        <div className="field">
          <label className="field-label" htmlFor="street">
            Street
          </label>
          <input
            id="street"
            className="input"
            value={value.street ?? ''}
            onChange={(e) => onChange({ street: e.target.value })}
          />
        </div>
      )}
      {showBarangay && (
        <div className="field">
          <label className="field-label" htmlFor="brgyCode">
            Barangay
          </label>
          <select
            id="brgyCode"
            className="select"
            value={value.brgyCode ?? ''}
            onChange={(e) => onChange({ brgyCode: e.target.value })}
          >
            <option value="" disabled>
              Select barangay
            </option>
            {barangays.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </select>
          {barangayError && <span className="field-error">Couldn't load the barangay list. Reload the page to try again.</span>}
        </div>
      )}
    </div>
  );
}

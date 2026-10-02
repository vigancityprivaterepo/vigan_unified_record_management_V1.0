import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { DynamicFieldDef } from '../lib/dynamicFieldSchema';
import { parseIntake, submitIntake, type IntakeModule } from './intakeSubmission';
import { previewPerson } from './resolvePerson';

// Bulk import: an office loads many records for one of its programs from a
// spreadsheet (CSV) instead of typing them one by one. The browser reads the
// file and matches its columns to the form; this file turns each row's text
// cells into the values the form expects, then runs every row through the
// same intake as the registration form (services/intakeSubmission.ts):
// same validation, same person matching and duplicate review, same relief
// double-claim check, same audit entries.
//
// Two passes: check (dryRun, nothing written; says per row whether it would
// link to an existing citizen, create a new one, go to duplicate review, or
// has problems) and import (writes; rows with problems are skipped).
// Imported records carry data._importBatch so a batch can be traced.

export const MAX_ROWS_PER_REQUEST = 500;

export type ImportRow = { core?: Record<string, string>; fields?: Record<string, string> };
export type RowResult = {
  row: number;
  name: string | null;
  // check: 'match' | 'new' | 'review' | 'record' | 'invalid'
  // import: 'linked' | 'created' | 'review' | 'record' | 'invalid' | 'already_received' | 'failed'
  outcome: string;
  errors?: string[];
};

type FieldDef = DynamicFieldDef & { label: string };

const blank = (v: unknown): v is undefined | null | '' => v === undefined || v === null || String(v).trim() === '';

// YYYY-MM-DD, or month/day/year (5/7/1965 = May 7, the order Philippine
// forms and Excel in en-US use). Returned as YYYY-MM-DD; never via JS local
// time, which would shift dates by a day in UTC+8.
export function normalizeDate(raw: string): string | null {
  const t = raw.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const mdy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (mdy) [y, m, d] = [Number(mdy[3]), Number(mdy[1]), Number(mdy[2])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const YES = new Set(['yes', 'y', 'true', '1', 'oo']);
const NO = new Set(['no', 'n', 'false', '0', 'hindi']);

function coerceField(f: FieldDef, raw: string, errors: string[]): unknown {
  const v = raw.trim();
  const fail = (why: string) => { errors.push(`${f.label}: ${why}`); return undefined; };
  switch (f.fieldType) {
    case 'NUMBER': {
      const n = Number(v.replace(/,/g, ''));
      return Number.isFinite(n) ? n : fail(`"${v}" is not a number`);
    }
    case 'DATE':
      return normalizeDate(v) ?? fail(`"${v}" is not a date (use YYYY-MM-DD or month/day/year)`);
    case 'BOOLEAN': {
      const l = v.toLowerCase();
      return YES.has(l) ? true : NO.has(l) ? false : fail(`"${v}" is not yes or no`);
    }
    case 'SELECT': {
      if (f.options.length === 0) return v;
      return f.options.find((o) => o.toLowerCase() === v.toLowerCase()) ?? fail(`"${v}" is not one of: ${f.options.join(', ')}`);
    }
    case 'MULTISELECT': {
      const parts = v.split(/[;|]/).map((p) => p.trim()).filter(Boolean);
      if (f.options.length === 0) return parts;
      const out: string[] = [];
      for (const p of parts) {
        const hit = f.options.find((o) => o.toLowerCase() === p.toLowerCase());
        if (!hit) return fail(`"${p}" is not one of: ${f.options.join(', ')} (separate several with ;)`);
        out.push(hit);
      }
      return out;
    }
    default:
      return v;
  }
}

const SEX: Record<string, string> = { m: 'M', male: 'M', lalaki: 'M', f: 'F', female: 'F', babae: 'F' };

type Prepared = { ok: true; core: Record<string, unknown>; data: Record<string, unknown>; name: string | null } | { ok: false; errors: string[]; name: string | null };

function prepareRow(
  module: IntakeModule,
  fieldDefs: FieldDef[],
  barangays: Map<string, string>,
  row: ImportRow,
): Prepared {
  const errors: string[] = [];
  const c = row.core ?? {};
  const name = [c.lname, c.fname].filter((x) => !blank(x)).join(', ') || null;

  const core: Record<string, unknown> = {};
  if (module.collectPersonInfo) {
    for (const k of ['lname', 'fname', 'mname', 'civilStatus', 'street'] as const) if (!blank(c[k])) core[k] = String(c[k]).trim();
    if (blank(c.lname)) errors.push('Last name is required');
    if (blank(c.fname)) errors.push('First name is required');
    if (blank(c.bdate)) errors.push('Birthdate is required');
    else {
      const d = normalizeDate(String(c.bdate));
      if (d) core.bdate = d;
      else errors.push(`Birthdate: "${c.bdate}" is not a date (use YYYY-MM-DD or month/day/year)`);
    }
    if (!blank(c.sex)) {
      const s = SEX[String(c.sex).trim().toLowerCase()];
      if (s) core.sex = s;
      else errors.push(`Sex: "${c.sex}" is not M or F`);
    }
    if (!blank(c.barangay)) {
      const code = barangays.get(normBrgy(String(c.barangay)));
      if (code) core.brgyCode = code;
      else errors.push(`Barangay: "${c.barangay}" is not a Vigan barangay`);
    }
    // A module that may stand alone (Birth) still links when the person is
    // in Vigan; an import always tries to link.
    if (!module.requiresCitizenLink) core.linkToCitizen = 'true';
  }

  const fields: Record<string, unknown> = {};
  const raw = row.fields ?? {};
  for (const f of fieldDefs) {
    if (f.fieldType === 'FILE') {
      if (f.isRequired) errors.push(`${f.label}: files can't be imported; register these records one by one`);
      continue;
    }
    if (blank(raw[f.key])) continue;
    const v = coerceField(f, String(raw[f.key]), errors);
    if (v !== undefined) fields[f.key] = v;
  }
  if (errors.length) return { ok: false, errors, name };

  const parsed = parseIntake(module, fieldDefs.filter((f) => f.fieldType !== 'FILE'), core, fields);
  if (!parsed.ok) return { ok: false, errors: flattenZod(parsed.details, fieldDefs), name };
  return { ok: true, core: parsed.core, data: parsed.data, name };
}

function flattenZod(details: unknown, fieldDefs: FieldDef[]): string[] {
  const d = details as { formErrors?: string[]; fieldErrors?: Record<string, string[]> } | null;
  const label = (k: string) => fieldDefs.find((f) => f.key === k)?.label ?? k;
  const out = [...(d?.formErrors ?? [])];
  for (const [k, msgs] of Object.entries(d?.fieldErrors ?? {})) out.push(`${label(k)}: ${msgs.join(', ')}`);
  return out.length ? out : ['Invalid row'];
}

// "Barangay I (Poblacion)", "BARANGAY I", "barangay 1" ... -> one key.
const ROMAN: Record<string, string> = { '1': 'i', '2': 'ii', '3': 'iii', '4': 'iv', '5': 'v', '6': 'vi', '7': 'vii', '8': 'viii', '9': 'ix' };
export function normBrgy(s: string): string {
  const SKIP = new Set(['barangay', 'brgy', 'poblacion']);
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter((w) => !SKIP.has(w)).map((w) => ROMAN[w] ?? w).join(' ');
}

export async function runImport(
  client: PrismaClient,
  module: IntakeModule,
  rows: ImportRow[],
  opts: { dryRun: boolean; batchId?: string; actor: { userId: string; role: string } },
): Promise<{ batchId: string; results: RowResult[] }> {
  const [fieldRows, brgyRows] = await Promise.all([
    client.officeFormField.findMany({ where: { moduleId: module.id }, orderBy: { sortOrder: 'asc' } }),
    client.barangay.findMany({ select: { code: true, name: true } }),
  ]);
  const fieldDefs: FieldDef[] = fieldRows.map((f) => ({ key: f.key, label: f.label, fieldType: f.fieldType, options: f.options, isRequired: f.isRequired }));
  const barangays = new Map<string, string>();
  for (const b of brgyRows) {
    barangays.set(normBrgy(b.name), b.code);
    barangays.set(normBrgy(b.code), b.code);
  }
  const batchId = opts.batchId ?? randomUUID();

  const results: RowResult[] = [];
  // Sequential on purpose: two rows for the same new person must see each
  // other (the second links to the citizen the first created).
  for (const [i, row] of rows.entries()) {
    const prepared = prepareRow(module, fieldDefs, barangays, row);
    if (!prepared.ok) {
      results.push({ row: i, name: prepared.name, outcome: 'invalid', errors: prepared.errors });
      continue;
    }
    if (opts.dryRun) {
      if (!module.collectPersonInfo) { results.push({ row: i, name: prepared.name, outcome: 'record' }); continue; }
      const p = await previewPerson(client, {
        lname: prepared.core.lname as string, fname: prepared.core.fname as string, bdate: prepared.core.bdate as Date,
      });
      results.push({ row: i, name: prepared.name, outcome: p === 'matched' ? 'match' : p === 'needs_review' ? 'review' : 'new' });
      continue;
    }
    try {
      const outcome = await submitIntake(client, module, prepared.core, { ...prepared.data, _importBatch: batchId }, opts.actor);
      if (outcome.kind === 'linked') results.push({ row: i, name: prepared.name, outcome: outcome.status === 'created' ? 'created' : 'linked' });
      else if (outcome.kind === 'needs_review') results.push({ row: i, name: prepared.name, outcome: 'review' });
      else if (outcome.kind === 'already_received') results.push({ row: i, name: prepared.name, outcome: 'already_received', errors: [outcome.message] });
      else results.push({ row: i, name: prepared.name, outcome: 'record' });
    } catch (err) {
      console.error(err);
      results.push({ row: i, name: prepared.name, outcome: 'failed', errors: ['Could not be saved; try this row again'] });
    }
  }
  return { batchId, results };
}

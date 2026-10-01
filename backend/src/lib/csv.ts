import type { Response } from 'express';

type Cell = string | number | boolean | Date | null | undefined;

// RFC 4180 quoting, plus a guard against CSV/formula injection: a cell that
// starts with = + - @ (or a tab/CR) would run as a formula when the export
// is opened in Excel/Sheets, so it's prefixed with a single quote.
function cell(value: Cell): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

// BOM so Excel opens UTF-8 names (ñ, accented vowels) correctly.
export function sendCsv(res: Response, filename: string, header: string[], rows: Cell[][]): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  res.send(`\uFEFF${toCsv(header, rows)}`);
}

// Reads a CSV file as saved by Excel, LibreOffice or Google Sheets: quoted
// cells (with "" for a quote and line breaks inside quotes), CRLF or LF line
// ends, a UTF-8 byte-order mark, and comma, semicolon or tab separators (the
// separator is whichever appears most in the header line). Blank lines are
// dropped. Returns the header row and the data rows, each padded/trimmed to
// the header's length.
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t'].reduce((best, c) => (firstLine.split(c).length > firstLine.split(best).length ? c : best), ',');

  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      records.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); records.push(row); }

  const nonBlank = records.filter((r) => r.some((c) => c.trim() !== ''));
  const headers = (nonBlank[0] ?? []).map((h) => h.trim());
  const rows = nonBlank.slice(1).map((r) => headers.map((_, i) => (r[i] ?? '').trim()));
  return { headers, rows };
}

// RFC 4180 cell for files we hand back (template, problem rows).
export function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function downloadCsv(name: string, lines: string[][]): void {
  // Byte-order mark first, so Excel opens UTF-8 names (ñ) correctly.
  const blob = new Blob([String.fromCharCode(0xfeff), `${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// A name reduced to what identifies it, so "Ma. Cristina", "MARIA CRISTINA"
// and "Maria-Cristina" compare equal, as do "Dela Cruz" and "DE LA CRUZ".
// The same rule as the database's name_key() (migration
// 20261013110000_name_matching), which does the actual matching; this copy
// is for keys built in code. Change both together.
export function nameKey(name: string): string {
  return name
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\b(JR|SR|II|III|IV)\b/g, '')
    .replace(/\bMA\b/g, 'MARIA')
    .replace(/\bSTA\b/g, 'SANTA')
    .replace(/\bSTO\b/g, 'SANTO')
    .replace(/ /g, '');
}

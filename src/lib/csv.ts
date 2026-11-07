// Quote every field; neutralize formulas and leading control characters before CSV escaping.
export function csvCell(value: string) {
  const safe = /^(?:[\s\u0000-\u001f]*[=+\-@]|[\u0000-\u001f])/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function csvRow(values: string[]) { return values.map(csvCell).join(",") + "\r\n"; }

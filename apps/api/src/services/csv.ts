// RFC 4180 quoting plus protection against spreadsheet formula injection.
export function csv(rows: unknown[][]) {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((value) => {
            let s = value instanceof Date ? value.toISOString() : String(value ?? '');
            if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(','),
      )
      .join('\r\n') +
    '\r\n'
  );
}

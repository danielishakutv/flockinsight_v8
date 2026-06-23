/** Small dependency-free CSV helpers (RFC 4180-ish). */

/** Serialize a cell, quoting only when needed. */
function cell(value: string | number | null): string {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows → CSV text with CRLF line endings. */
export function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

/** Leading UTF-8 BOM so Excel opens the file as UTF-8. */
export const CSV_BOM = String.fromCharCode(0xfeff);

/**
 * Parse CSV text into rows of string cells. Handles quoted fields, escaped
 * quotes (""), and newlines inside quotes. Blank lines are dropped.
 */
export function parseCsv(input: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // Drop fully-empty rows (e.g. trailing blank line).
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      endField();
      i++;
      continue;
    }
    if (c === "\n") {
      endRow();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush the final field/row if the file didn't end with a newline.
  if (field !== "" || row.length > 0) endRow();

  return rows;
}

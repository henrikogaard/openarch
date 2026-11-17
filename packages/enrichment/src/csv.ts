import type { RawResource } from './types';

/**
 * Split CSV text into logical rows, honouring RFC-4180 style quoting:
 * quoted fields may contain commas and newlines, and a doubled quote ("")
 * represents a literal quote character.
 */
function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false;

  const endField = (): void => {
    row.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
    } else {
      field += char;
      fieldStarted = true;
    }
  }
  // Flush a trailing field/row unless the text ended exactly after a newline.
  if (fieldStarted || row.length > 0) endRow();
  return rows;
}

/** Strip a UTF-8 BOM and surrounding whitespace from a header name. */
function cleanHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim();
}

/**
 * Parse CSV text (with a header row) into raw resources. The key is taken from
 * an id/key/name column when present, otherwise a stable `row-N` value.
 */
export function parseCsvResources(text: string, source = 'csv'): RawResource[] {
  const rows = parseRows(text).filter((cells) => cells.some((cell) => cell.trim() !== ''));
  if (rows.length === 0) return [];
  const headers = rows[0].map(cleanHeader);
  const keyIndex = headers.findIndex((header) =>
    ['id', 'key', 'name'].includes(header.toLowerCase()),
  );

  return rows.slice(1).map((cells, index) => {
    const fields: Record<string, string> = {};
    headers.forEach((header, column) => {
      if (header) fields[header] = cells[column] ?? '';
    });
    const key = keyIndex >= 0 ? cells[keyIndex] ?? `row-${index + 1}` : `row-${index + 1}`;
    return { source, key: key.trim() || `row-${index + 1}`, fields };
  });
}

/** Render resources as a compact Markdown table for human preview. */
export function csvToMarkdown(resources: RawResource[]): string {
  if (resources.length === 0) return '_No resources._';
  const headers = [...new Set(resources.flatMap((resource) => Object.keys(resource.fields)))];
  const escape = (value: string): string => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const lines: string[] = [];
  lines.push(`| key | ${headers.map(escape).join(' | ')} |`);
  lines.push(`| --- | ${headers.map(() => '---').join(' | ')} |`);
  for (const resource of resources) {
    lines.push(
      `| ${escape(resource.key)} | ${headers.map((header) => escape(resource.fields[header] ?? '')).join(' | ')} |`,
    );
  }
  return lines.join('\n');
}

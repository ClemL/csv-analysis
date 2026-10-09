/** Serializes a small header + rows grid for pasting into chat, docs and spreadsheets. */

export interface TableData {
  headers: string[];
  rows: string[][];
}

function cell(row: string[], i: number): string {
  return row[i] ?? '';
}

/** GitHub-flavored Markdown. Pipes are escaped and line breaks become `<br>`. */
export function toMarkdown({ headers, rows }: TableData): string {
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const line = (values: string[]) => `| ${values.map(esc).join(' | ')} |`;
  return [
    line(headers),
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => line(headers.map((_, i) => cell(r, i)))),
  ].join('\n');
}

/** Tab-separated, which Excel, Sheets and Teams paste as cells. */
export function toTsv({ headers, rows }: TableData): string {
  const esc = (v: string) => v.replace(/[\t\r\n]+/g, ' ');
  return [headers, ...rows.map((r) => headers.map((_, i) => cell(r, i)))]
    .map((r) => r.map(esc).join('\t'))
    .join('\n');
}

/** A bare HTML table, which Outlook, Word and Teams paste as a formatted table. */
export function toHtml({ headers, rows }: TableData): string {
  const esc = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const th = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${headers.map((_, i) => `<td>${esc(cell(r, i))}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

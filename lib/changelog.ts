/**
 * The changelog lives in public/updates.txt, one entry per line, oldest
 * first, so shipping an entry is a one-line append. This turns the file's
 * text into its entries.
 */

/** Entries in file order: lines trimmed, blank lines dropped. Handles CRLF and CR endings. */
export function parseChangelog(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

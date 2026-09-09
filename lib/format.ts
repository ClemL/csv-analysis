/** Display helpers shared by the analyzer UI. */

const NUMBER = new Intl.NumberFormat('en-US');

export function formatInt(n: number): string {
  return NUMBER.format(Math.round(n));
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Number.isInteger(n)) return NUMBER.format(n);
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 3 : 6;
  return NUMBER.format(Number(n.toFixed(digits)));
}

export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(fraction > 0 && fraction < 0.01 ? 2 : 1)}%`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Makes whitespace-only and empty values visible in dense tables. */
export function displayValue(value: string | undefined): string {
  if (value === undefined) return '—';
  if (value === '') return '(empty)';
  if (value.trim() === '') return '(whitespace)';
  return value;
}

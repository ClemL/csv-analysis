/**
 * Sample data built from the openFDA National Drug Code directory.
 *
 * This is the only network call the application makes. It is outbound only,
 * carries nothing but the search term typed into the generator, and happens
 * solely in the Generate tab — pasted and opened files are never sent anywhere.
 *
 * Every field of the API response is treated as optional. The endpoint is
 * public and versionless, so a record missing `brand_name` or `packaging`
 * should produce a blank cell, never a crash.
 */

import { serializeDelimited } from './csv.ts';

export const NDC_ENDPOINT = 'https://api.fda.gov/drug/ndc.json';

/** openFDA caps `limit` at 1000 records per request. */
export const MAX_LIMIT = 1000;

export type SearchField = 'any' | 'brand_name' | 'generic_name' | 'labeler_name' | 'dosage_form';

export const SEARCH_FIELDS: { id: SearchField; label: string; example: string }[] = [
  { id: 'any', label: 'Anything', example: 'semaglutide' },
  { id: 'brand_name', label: 'Brand name', example: 'Ozempic' },
  { id: 'generic_name', label: 'Generic name', example: 'metformin hydrochloride' },
  { id: 'labeler_name', label: 'Labeler', example: 'Novo Nordisk' },
  { id: 'dosage_form', label: 'Dosage form', example: 'TABLET' },
];

/** The subset of the openFDA record this app reads. All of it is optional. */
export interface NdcProduct {
  product_ndc?: string;
  product_type?: string;
  brand_name?: string;
  generic_name?: string;
  dosage_form?: string;
  route?: string[];
  marketing_category?: string;
  marketing_start_date?: string;
  application_number?: string;
  labeler_name?: string;
  dea_schedule?: string;
  active_ingredients?: { name?: string; strength?: string }[];
  packaging?: { package_ndc?: string; description?: string; marketing_start_date?: string }[];
  pharm_class?: string[];
}

export interface NdcResponse {
  meta?: { results?: { skip?: number; limit?: number; total?: number } };
  results?: NdcProduct[];
}

export function buildNdcUrl(options: {
  field: SearchField;
  term: string;
  limit: number;
  skip?: number;
}): string {
  const params = new URLSearchParams();
  const term = options.term.trim();

  if (term) {
    // Quoting keeps multi-word terms as a phrase rather than an OR of words.
    const phrase = `"${term.replace(/"/g, '')}"`;
    params.set('search', options.field === 'any' ? phrase : `${options.field}:${phrase}`);
  }
  params.set('limit', String(Math.min(Math.max(Math.trunc(options.limit), 1), MAX_LIMIT)));
  if (options.skip) params.set('skip', String(options.skip));

  return `${NDC_ENDPOINT}?${params.toString()}`;
}

export class NdcError extends Error {
  // A plain field rather than a constructor parameter property: the test
  // runner strips types without transforming, and cannot desugar those.
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'NdcError';
    this.status = status;
  }
}

/** openFDA answers "no matches" with a 404, which is not an application error. */
export async function fetchNdcProducts(
  url: string,
  signal?: AbortSignal,
): Promise<{ products: NdcProduct[]; total: number }> {
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (cause) {
    throw new NdcError(
      `Could not reach api.fda.gov. Check the network, or a browser extension blocking the request. (${
        cause instanceof Error ? cause.message : String(cause)
      })`,
    );
  }

  if (response.status === 404) {
    throw new NdcError('No products matched that search.', 404);
  }
  if (response.status === 429) {
    throw new NdcError(
      'openFDA rate limit reached. Without an API key it allows 240 requests per minute and 1,000 per day per IP address.',
      429,
    );
  }
  if (!response.ok) {
    throw new NdcError(`openFDA returned ${response.status} ${response.statusText}.`, response.status);
  }

  let body: NdcResponse;
  try {
    body = (await response.json()) as NdcResponse;
  } catch {
    throw new NdcError('openFDA returned a response that was not JSON.');
  }

  const products = Array.isArray(body.results) ? body.results : [];
  return { products, total: body.meta?.results?.total ?? products.length };
}

/** openFDA writes dates as YYYYMMDD; ISO makes them parse as dates downstream. */
export function isoDate(compact: string | undefined): string {
  if (!compact || !/^\d{8}$/.test(compact)) return compact ?? '';
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function firstIngredient(product: NdcProduct): { name: string; strength: string } {
  const first = product.active_ingredients?.[0];
  return { name: first?.name ?? '', strength: first?.strength ?? '' };
}

export type Shape = 'directory' | 'claims';

export interface GenerateOptions {
  shape: Shape;
  delimiter: string;
  rows: number;
  /** Injects blanks, NULL tokens, a quoted field and a ragged row. */
  imperfections: boolean;
  /** Fixed seed keeps generated output reproducible. */
  seed?: number;
}

/** Small deterministic PRNG, so the same seed yields the same file. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRECTORY_HEADER = [
  'product_ndc',
  'brand_name',
  'generic_name',
  'labeler_name',
  'dosage_form',
  'route',
  'active_ingredient',
  'strength',
  'marketing_category',
  'marketing_start_date',
  'dea_schedule',
  'package_ndc',
  'package_description',
];

function directoryRow(product: NdcProduct): string[] {
  const ingredient = firstIngredient(product);
  const pack = product.packaging?.[0];
  return [
    product.product_ndc ?? '',
    product.brand_name ?? '',
    product.generic_name ?? '',
    product.labeler_name ?? '',
    product.dosage_form ?? '',
    product.route?.join('; ') ?? '',
    ingredient.name,
    ingredient.strength,
    product.marketing_category ?? '',
    isoDate(product.marketing_start_date),
    product.dea_schedule ?? '',
    pack?.package_ndc ?? '',
    pack?.description ?? '',
  ];
}

const CLAIMS_HEADER = [
  'claim_id',
  'member_id',
  'fill_date',
  'ndc',
  'brand_name',
  'generic_name',
  'quantity',
  'days_supply',
  'unit_cost',
  'total_cost',
  'pharmacy',
  'covered_entity',
];

const PHARMACIES = [
  'Walgreens #4412',
  'CVS #1120',
  'Mail Order',
  'Rite Aid #8802',
  'Hospital Outpatient',
];
/**
 * Invented covered entities, deliberately not real organizations: this data is
 * fabricated, and fabricated claims should not carry a real provider's name.
 * The parent-and-site shape (one code plus suffixed locations) is kept because
 * it gives the column a realistic low-cardinality grouping to profile.
 */
export const COVERED_ENTITIES = [
  'RIVERBEND',
  'RIVERBEND-NORTH',
  'RIVERBEND-SOUTH',
  'NORTHGATE',
  'LAKESHORE',
];

/**
 * Synthesizes claim rows against real NDCs. The drug data is genuine; the
 * members, costs and dates are fabricated, which is the point — it exercises
 * dates, integers, decimals and identifier columns without any real PHI.
 */
function claimsRow(product: NdcProduct, index: number, random: () => number): string[] {
  const quantity = [30, 60, 90, 14, 28][Math.floor(random() * 5)];
  const daysSupply = quantity <= 30 ? 30 : quantity === 60 ? 60 : 90;
  const unitCost = Math.round((random() * 240 + 1.5) * 100) / 100;
  const day = Math.floor(random() * 28) + 1;
  const month = Math.floor(random() * 6) + 1;

  return [
    String(600000 + index),
    `M${String(88000 + Math.floor(random() * 900))}`,
    `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    product.product_ndc ?? '',
    product.brand_name ?? '',
    product.generic_name ?? '',
    String(quantity),
    String(daysSupply),
    unitCost.toFixed(2),
    (Math.round(unitCost * quantity * 100) / 100).toFixed(2),
    PHARMACIES[Math.floor(random() * PHARMACIES.length)],
    COVERED_ENTITIES[Math.floor(random() * COVERED_ENTITIES.length)],
  ];
}

/**
 * Dirties a small share of rows so the analyzer's warnings have something to
 * find: blanks, a NULL token, a value that breaks its column's type, a field
 * needing quotes, and one short row.
 */
function addImperfections(rows: string[][], random: () => number): string[][] {
  if (rows.length < 2) return rows;
  const body = rows.slice(1);
  const width = rows[0].length;

  body.forEach((row, i) => {
    if (i % 7 === 3) row[width - 1] = '';
    if (i % 11 === 5) row[width - 2] = 'NULL';
    if (i % 13 === 9 && width > 6) row[6] = 'PENDING';
    if (i % 5 === 2) row[Math.min(4, width - 1)] = `${row[Math.min(4, width - 1)]}, see notes`;
  });

  // One short row, to trip the ragged-row warning.
  const victim = Math.min(body.length - 1, Math.floor(random() * body.length));
  body[victim] = body[victim].slice(0, Math.max(1, width - 2));

  // One exact duplicate, to trip the duplicate-row warning.
  if (body.length > 2) body.push([...body[1]]);

  return [rows[0], ...body];
}

export interface GeneratedSample {
  text: string;
  rowCount: number;
  columnCount: number;
}

export function generateSample(
  products: NdcProduct[],
  options: GenerateOptions,
): GeneratedSample {
  const random = mulberry32(options.seed ?? 20260101);
  const wanted = Math.max(1, Math.trunc(options.rows));
  const header = options.shape === 'claims' ? CLAIMS_HEADER : DIRECTORY_HEADER;

  const body: string[][] = [];
  for (let i = 0; i < wanted && products.length > 0; i += 1) {
    // Cycle the source records when more rows were asked for than returned.
    const product = products[i % products.length];
    body.push(options.shape === 'claims' ? claimsRow(product, i, random) : directoryRow(product));
  }

  let rows = [header, ...body];
  if (options.imperfections) rows = addImperfections(rows, random);

  return {
    text: serializeDelimited(rows, options.delimiter),
    rowCount: rows.length - 1,
    columnCount: header.length,
  };
}

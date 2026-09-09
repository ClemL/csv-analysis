'use client';

import { useCallback, useRef, useState } from 'react';
import { DELIMITERS, delimiterById } from '@/lib/csv';
import {
  buildNdcUrl,
  fetchNdcProducts,
  generateSample,
  MAX_LIMIT,
  NdcError,
  SEARCH_FIELDS,
  type GeneratedSample,
  type NdcProduct,
  type SearchField,
  type Shape,
} from '@/lib/ndc';
import { formatInt } from '@/lib/format';
import { Panel } from './Panel';
import { Menu } from './Menu';

const SHAPES: { id: Shape; label: string; description: string }[] = [
  {
    id: 'claims',
    label: 'Claims extract',
    description:
      'Synthetic claim rows against real NDCs — identifiers, dates, quantities and costs. Members and costs are fabricated; only the drug data is real.',
  },
  {
    id: 'directory',
    label: 'NDC directory',
    description: 'The openFDA product records themselves: NDC, names, labeler, dosage form.',
  },
];

export function GeneratorView({
  onUse,
}: {
  onUse: (target: 'analyze' | 'a' | 'b', text: string) => void;
}) {
  const [field, setField] = useState<SearchField>('brand_name');
  const [term, setTerm] = useState('Ozempic');
  const [shape, setShape] = useState<Shape>('claims');
  const [rows, setRows] = useState(50);
  const [delimiterId, setDelimiterId] = useState('comma');
  const [imperfections, setImperfections] = useState(false);
  const [seed, setSeed] = useState(20260101);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<NdcProduct[] | null>(null);
  const [total, setTotal] = useState(0);
  const [sample, setSample] = useState<GeneratedSample | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const build = useCallback(
    (source: NdcProduct[]) =>
      generateSample(source, {
        shape,
        delimiter: delimiterById(delimiterId as Parameters<typeof delimiterById>[0]).value,
        rows,
        imperfections,
        seed,
      }),
    [shape, delimiterId, rows, imperfections, seed],
  );

  const generate = async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    setError(null);

    try {
      const url = buildNdcUrl({ field, term, limit: Math.min(rows, MAX_LIMIT) });
      const result = await fetchNdcProducts(url, controller.signal);
      setProducts(result.products);
      setTotal(result.total);
      setSample(build(result.products));
    } catch (cause) {
      if (controller.signal.aborted) return;
      setProducts(null);
      setSample(null);
      setError(cause instanceof NdcError ? cause.message : String(cause));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  // Reshaping already-fetched records needs no second request.
  const regenerate = () => products && setSample(build(products));

  const activeShape = SHAPES.find((s) => s.id === shape);
  const example = SEARCH_FIELDS.find((f) => f.id === field)?.example;

  return (
    <>
      <Panel
        id="generator"
        title="Generate sample data"
        meta="openFDA National Drug Code directory"
        actions={
          <>
            <button type="button" onClick={generate} disabled={loading}>
              {loading ? 'Fetching…' : products ? 'Fetch again' : 'Fetch from openFDA'}
            </button>
            {sample ? (
              <Menu
                label="Use in"
                items={[
                  { label: 'Analyze', onSelect: () => onUse('analyze', sample.text) },
                  { label: 'Compare as A', onSelect: () => onUse('a', sample.text) },
                  { label: 'Compare as B', onSelect: () => onUse('b', sample.text) },
                ]}
              />
            ) : null}
          </>
        }
      >
        <div className="panel-body">
          <div className="notice info">
            This is the only request the app makes, and it sends nothing but the search term below.
            Pasted and opened files never leave your browser. openFDA allows 240 requests per minute
            and 1,000 per day per IP address without a key.
          </div>
        </div>

        <div className="toolbar generator-toolbar">
          <label className="field">
            Search
            <select value={field} onChange={(e) => setField(e.target.value as SearchField)}>
              {SEARCH_FIELDS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field grow">
            <input
              type="text"
              value={term}
              spellCheck={false}
              placeholder={example ? `e.g. ${example} — blank for anything` : 'blank for anything'}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && generate()}
            />
          </label>

          <label className="field">
            Shape
            <select
              value={shape}
              onChange={(e) => {
                setShape(e.target.value as Shape);
                setSample(null);
              }}
            >
              {SHAPES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            Rows
            <input
              type="number"
              min={1}
              max={MAX_LIMIT}
              value={rows}
              onChange={(e) => setRows(Number(e.target.value) || 1)}
            />
          </label>

          <label className="field">
            Delimiter
            <select value={delimiterId} onChange={(e) => setDelimiterId(e.target.value)}>
              {DELIMITERS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} ({d.display})
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            Seed
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 0)}
              title="The same seed reproduces the same file."
            />
          </label>

          <label className="field">
            <input
              type="checkbox"
              checked={imperfections}
              onChange={(e) => setImperfections(e.target.checked)}
            />
            Add imperfections
          </label>

          {products ? (
            <button type="button" onClick={regenerate}>
              Rebuild
            </button>
          ) : null}
        </div>

        <div className="panel-body">
          <p className="shape-note">{activeShape?.description}</p>
          {imperfections ? (
            <p className="shape-note">
              Imperfections add blank cells, a <code>NULL</code> token, a value that breaks its
              column&apos;s type, a field needing quotes, one short row and one exact duplicate — so
              every warning the analyzer can raise has something to find.
            </p>
          ) : null}

          {error ? <div className="notice bad">{error}</div> : null}

          {products && !error ? (
            <p className="shape-note">
              {formatInt(products.length)} product record(s) returned
              {total > products.length ? ` of ${formatInt(total)} matching` : ''}
              {sample && sample.rowCount > products.length
                ? `; source records were cycled to reach ${formatInt(sample.rowCount)} rows`
                : ''}
              .
            </p>
          ) : null}
        </div>
      </Panel>

      {sample ? (
        <Panel
          id="generator-output"
          title="Generated CSV"
          meta={`${formatInt(sample.rowCount)} rows × ${formatInt(sample.columnCount)} columns`}
          actions={
            <>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(sample.text).catch(() => {})}
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([sample.text], { type: 'text/csv;charset=utf-8' }),
                  );
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `ndc-${shape}-sample.csv`;
                  link.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download .csv
              </button>
            </>
          }
        >
          <div className="script">
            <textarea
              readOnly
              value={sample.text}
              rows={Math.min(sample.rowCount + 2, 22)}
              spellCheck={false}
              aria-label="Generated CSV"
            />
          </div>
        </Panel>
      ) : null}
    </>
  );
}

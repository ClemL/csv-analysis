'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DELIMITERS } from '@/lib/csv';
import { formatBytes, formatInt } from '@/lib/format';
import {
  isApplicableFileName,
  MAX_FILE_NAME,
  outputFileName,
  sheetOutput,
  type CellNote,
  type Newline,
  type SheetOutput,
  type SheetSplit,
  type WorkbookSplit,
} from '@/lib/xlsx';
import { writeZip } from '@/lib/zip';
import { Panel } from './Panel';
import { CopyButton } from './ScriptBox';
import { startSplit, type XlsxJob } from './xlsxClient';

interface LoadedFile {
  name: string;
  size: number;
  bytes: ArrayBuffer;
}

/** Lines shown in a sheet's preview; copy and download always carry the whole file. */
const PREVIEW_LINES = 400;

const NEWLINES: { value: Newline; label: string }[] = [
  { value: '\r\n', label: 'CRLF (Windows host)' },
  { value: '\n', label: 'LF (Linux host)' },
];

/** The importer's skip-row settings are keyed by the trimmed, upper-cased sheet name. */
const skipKey = (sheet: string) => sheet.trim().toUpperCase();

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** A few addresses, then a count of the rest. */
function Cells({ notes, show = 6, detail = false }: { notes: CellNote[]; show?: number; detail?: boolean }) {
  return (
    <>
      {notes.slice(0, show).map((n, i) => (
        <span key={`${n.address}-${i}`}>
          {i > 0 ? ', ' : ' '}
          <code>{n.address}</code>
          {detail ? ` ${n.detail}` : ''}
        </span>
      ))}
      {notes.length > show ? ` and ${formatInt(notes.length - show)} more` : ''}
    </>
  );
}

interface Output {
  sheet: SheetSplit;
  name: string;
  truncated: boolean;
  /** Another sheet's output has the same name; the later one overwrites the earlier. */
  clash: boolean;
  output: SheetOutput | null;
}

function SheetPanel({
  item,
  extension,
  skip,
  onSkip,
  onOpen,
  busy,
}: {
  item: Output;
  extension: string;
  skip: number;
  onSkip: (value: number) => void;
  onOpen: (text: string, name: string) => void;
  /** A re-read is under way; what is shown is the previous read until it lands. */
  busy: boolean;
}) {
  const { sheet, output } = item;
  const columns = sheet.rows[0]?.cells.length ?? 0;
  const preview = useMemo(() => {
    if (!output) return '';
    let at = 0;
    for (let line = 0; line < PREVIEW_LINES; line++) {
      const next = output.text.indexOf('\n', at);
      if (next === -1) return output.text;
      at = next + 1;
    }
    return output.text.slice(0, at);
  }, [output]);

  const crashes = sheet.crashes.filter((c) => c.address);
  const meta = [
    `sheet “${sheet.name}”`,
    ...(sheet.state !== 'visible' ? [sheet.state === 'hidden' ? 'hidden' : 'very hidden'] : []),
    ...(sheet.range ? [sheet.range, `${formatInt(output?.lineCount ?? 0)} rows × ${formatInt(columns)} columns`] : ['empty']),
  ].join(' · ');

  return (
    <Panel
      id={`xlsx-sheet-${sheet.name}`}
      title={item.name}
      meta={meta}
      className="xlsx-sheet"
      actions={
        output ? (
          <span className="xlsx-actions">
            <CopyButton text={output.text} disabled={busy} />
            <button type="button" disabled={busy} onClick={() => download(item.name, output.text, 'text/csv;charset=utf-8')}>
              Download
            </button>
          </span>
        ) : null
      }
    >
      {sheet.range === null ? (
        <div className="panel-body">
          <div className="notice bad">
            <span className="finding-kind">Importer fails</span>
            Nothing on this sheet counts as used (a value, a formula or a comment), so{' '}
            <code>RangeUsed()</code> returns null and the importer throws a NullReferenceException here. No
            file is written for this sheet or for any sheet after it, and the workbook is not loaded.
          </div>
        </div>
      ) : (
        <>
          <div className="toolbar xlsx-toolbar">
            <label className="field" title="The importer's skip-row setting for this sheet: used rows dropped from the top.">
              Skip rows
              <input
                type="number"
                min={0}
                value={skip}
                onChange={(e) => onSkip(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              />
            </label>
            <span className="spacer" />
            <button type="button" disabled={busy} onClick={() => output && onOpen(output.text, item.name)}>
              Open in Analyze
            </button>
          </div>
          <SheetNotices item={item} crashes={crashes} extension={extension} />
          <textarea
            className="compact xlsx-preview"
            readOnly
            value={preview}
            rows={Math.min(Math.max((output?.lineCount ?? 0) + 1, 3), 14)}
            spellCheck={false}
            aria-label={`${item.name} contents`}
          />
          {output && output.lineCount > PREVIEW_LINES ? (
            <div className="panel-body xlsx-more">
              Showing the first {formatInt(PREVIEW_LINES)} of {formatInt(output.lineCount)} lines. Copy and
              Download carry them all.
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}

function SheetNotices({ item, crashes, extension }: { item: Output; crashes: CellNote[]; extension: string }) {
  const { sheet, output } = item;
  const notices: React.ReactNode[] = [];
  if (crashes.length) {
    notices.push(
      <div key="crash" className="notice bad">
        <span className="finding-kind">Importer fails</span>
        The importer throws on {crashes.length === 1 ? 'this cell' : 'these cells'} and stops:
        <Cells notes={crashes} show={4} detail />. Here such a cell reads <code>!</code> and the exception name.
      </div>,
    );
  }
  if (sheet.rawFormats.length) {
    notices.push(
      <div key="raw" className="notice warn">
        <span className="finding-kind">Format code printed</span>
        {formatInt(sheet.rawFormats.length)} cell(s) print their number format instead of their value, because
        ClosedXML&apos;s formatter cannot read <code>{sheet.rawFormats[0].detail}</code>
        {sheet.rawFormats[0].detail.endsWith(' tt') ? ' (the .NET pattern it uses for Excel’s built-in AM/PM times)' : ''}:
        <Cells notes={sheet.rawFormats} />.
      </div>,
    );
  }
  if (output?.unquoted.length) {
    notices.push(
      <div key="unquoted" className="notice warn">
        <span className="finding-kind">Unquoted</span>
        {formatInt(output.unquoted.length)} value(s) hold the separator or a line break. The importer writes
        fields without quotes, so these rows split into extra fields or lines:
        <Cells notes={output.unquoted} />.
      </div>,
    );
  }
  if (sheet.uncachedFormulas.length) {
    notices.push(
      <div key="formulas" className="notice warn">
        <span className="finding-kind">Not calculated</span>
        {formatInt(sheet.uncachedFormulas.length)} formula(s) were saved without a result. ClosedXML calculates
        them while converting; this page cannot, so they are blank here:
        <Cells notes={sheet.uncachedFormulas} show={3} detail />.
      </div>,
    );
  }
  if (item.clash) {
    notices.push(
      <div key="clash" className="notice warn">
        <span className="finding-kind">Same name</span>
        Another sheet writes a file with this name, so the later sheet overwrites the earlier one.
      </div>,
    );
  }
  if (item.truncated) {
    notices.push(
      <div key="truncated" className="notice warn">
        <span className="finding-kind">Name cut</span>
        The name passes {MAX_FILE_NAME} characters, so the importer cuts it there
        {item.name.endsWith(`.${extension}`) ? '' : `, and the .${extension} extension goes with it`}.
      </div>,
    );
  }
  if (sheet.unreadable.length) {
    notices.push(
      <div key="unreadable" className="notice info">
        <span className="finding-kind">Left blank</span>
        {formatInt(sheet.unreadable.length)} stored value(s) are not valid for their cell type; ClosedXML
        leaves them blank, and so does this page:
        <Cells notes={sheet.unreadable} show={3} detail />.
      </div>,
    );
  }
  return notices.length ? (
    <div className="panel-body xlsx-notices">
      <div className="notices">{notices}</div>
    </div>
  ) : null;
}

export function XlsxView({ onOpen }: { onOpen: (text: string, name: string) => void }) {
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [separator, setSeparator] = useState('|');
  const [newline, setNewline] = useState<Newline>('\r\n');
  const [extension, setExtension] = useState('csv');
  const [skips, setSkips] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{ split: WorkbookSplit; file: LoadedFile; newline: Newline } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const job = useRef<XlsxJob | null>(null);

  // Line endings inside rich and inline text follow the host, so a change re-reads the workbook.
  useEffect(() => {
    job.current?.cancel();
    setError(null);
    if (!file) {
      setResult(null);
      return;
    }
    const current = startSplit(file.bytes, newline);
    job.current = current;
    current.promise.then(
      (split) => {
        if (job.current === current) setResult({ split, file, newline });
      },
      (cause: unknown) => {
        if (job.current !== current) return;
        setResult(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => current.cancel();
  }, [file, newline]);

  const openFile = (opened: File) => {
    opened.arrayBuffer().then((bytes) => {
      setSkips({});
      setFile({ name: opened.name, size: opened.size, bytes });
    });
  };

  // Until a re-read for a new file or line ending lands, the previous read stays on
  // screen, whole and consistent, with its actions disabled.
  const pending = file !== null && error === null && (result?.file !== file || result.newline !== newline);

  const outputs: Output[] = useMemo(() => {
    if (!result) return [];
    const ext = extension || 'csv';
    const items = result.split.sheets.map((sheet) => {
      const { name, truncated } = outputFileName(result.file.name, sheet.name, ext);
      const output = sheet.range
        ? sheetOutput(sheet, { separator, newline: result.newline, skipRows: skips[skipKey(sheet.name)] ?? 0 })
        : null;
      return { sheet, name, truncated, clash: false, output };
    });
    const seen = new Map<string, number>();
    for (const item of items) seen.set(item.name.toLowerCase(), (seen.get(item.name.toLowerCase()) ?? 0) + 1);
    for (const item of items) item.clash = (seen.get(item.name.toLowerCase()) ?? 0) > 1;
    return items;
  }, [result, separator, skips, extension]);

  const written = outputs.filter((o) => o.output);
  const crashes = outputs.flatMap((o) => o.sheet.crashes.map((c) => ({ sheet: o.sheet.name, ...c })));
  const firstCrash: (CellNote & { sheet: string }) | undefined = crashes.find((c) => c.opening) ?? crashes[0];

  const downloadAll = () => {
    if (!result) return;
    const encoder = new TextEncoder();
    const zip = writeZip(written.map((o) => ({ name: o.name, data: encoder.encode(o.output!.text) })));
    const base = result.file.name.replace(/\.[^.]*$/, '');
    download(`${base}-${extension || 'csv'}.zip`, zip as Uint8Array<ArrayBuffer>, 'application/zip');
  };

  return (
    <>
      <Panel
        id="xlsx-input"
        title="Workbook"
        forceOpen={!file}
        className={dragging ? 'dropzone' : undefined}
        meta={file ? `${file.name} · ${formatBytes(file.size)}` : 'open, or drop an .xlsx file here'}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) openFile(dropped);
        }}
        actions={
          <>
            <button type="button" onClick={() => fileInput.current?.click()}>
              Open workbook
            </button>
            {written.length > 1 ? (
              <button type="button" disabled={pending} onClick={downloadAll}>
                Download all (.zip)
              </button>
            ) : null}
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              aria-label="Workbook file"
              onChange={(e) => {
                const opened = e.target.files?.[0];
                if (opened) openFile(opened);
                e.target.value = '';
              }}
            />
          </>
        }
      >
        <div className="toolbar xlsx-toolbar">
          <label className="field">
            Separator
            <select value={separator} onChange={(e) => setSeparator(e.target.value)}>
              {DELIMITERS.map((d) => (
                <option key={d.id} value={d.value}>
                  {d.label} ({d.display})
                </option>
              ))}
            </select>
          </label>
          <label className="field" title="File.WriteAllLines ends lines with the host's Environment.NewLine.">
            Line ending
            <select value={newline} onChange={(e) => setNewline(e.target.value as Newline)}>
              {NEWLINES.map((n) => (
                <option key={n.label} value={n.value}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Extension
            <input
              type="text"
              value={extension}
              spellCheck={false}
              onChange={(e) => setExtension(e.target.value.replace(/^\.+/, ''))}
            />
          </label>
        </div>

        <div className="panel-body">
          {!file ? (
            <p className="shape-note">
              Each worksheet becomes one file named <code>{'{workbook}.{sheet}.csv'}</code>, holding the
              sheet&apos;s used range with every value as Excel would display it, fields joined by the separator
              and never quoted. Hidden sheets are included. The workbook is read here, in the browser, and is not
              uploaded.
            </p>
          ) : null}
          {pending ? <p className="shape-note" role="status">Reading the workbook…</p> : null}
          {error ? <div className="notice bad">Could not read this workbook: {error}</div> : null}
          {result ? (
            <div className="notices">
              {firstCrash ? (
                <div className="notice bad">
                  <span className="finding-kind">Importer fails</span>
                  The importer throws on this workbook, first at <code>{firstCrash.sheet}</code>
                  {firstCrash.address ? (
                    <>
                      {' '}
                      <code>{firstCrash.address}</code>
                    </>
                  ) : null}{' '}
                  ({firstCrash.detail.split(':')[0]}), and the file is not loaded. The sheets below show what
                  each would hold.
                </div>
              ) : null}
              {!isApplicableFileName(result.file.name) ? (
                <div className="notice warn">
                  <span className="finding-kind">Not picked up</span>
                  The importer only cleans files whose name contains <code>.xlsx</code>, so it would pass this
                  one over.
                </div>
              ) : null}
              {result.split.date1904 ? (
                <div className="notice info">
                  <span className="finding-kind">1904 dates</span>
                  This workbook counts dates from 1904. ClosedXML moves date-formatted values on 1,462 days, so
                  dates print as Excel shows them; times and plain numbers are not moved.
                </div>
              ) : null}
              {result.split.skippedSheets.length ? (
                <div className="notice info">
                  <span className="finding-kind">Skipped</span>
                  Not worksheets, so nothing is written for them:{' '}
                  {result.split.skippedSheets.map((s, i) => (
                    <span key={s}>
                      {i > 0 ? ', ' : ''}
                      <code>{s}</code>
                    </span>
                  ))}
                  .
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {outputs.length ? (
          <div className="scroll">
            <table className="xlsx-files">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Sheet</th>
                  <th className="num">Rows</th>
                  <th className="num">Columns</th>
                </tr>
              </thead>
              <tbody>
                {outputs.map((o) => (
                  <tr key={o.sheet.name}>
                    <td className="mono">{o.output ? o.name : <span className="faint">{o.name} (not written)</span>}</td>
                    <td>
                      {o.sheet.name}
                      {o.sheet.state !== 'visible' ? <span className="faint"> · hidden</span> : null}
                    </td>
                    <td className="num">{o.output ? formatInt(o.output.lineCount) : '—'}</td>
                    <td className="num">{o.sheet.rows[0] ? formatInt(o.sheet.rows[0].cells.length) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>

      {outputs.map((item) => (
        <SheetPanel
          key={item.sheet.name}
          item={item}
          extension={extension || 'csv'}
          skip={skips[skipKey(item.sheet.name)] ?? 0}
          onSkip={(value) => setSkips((prev) => ({ ...prev, [skipKey(item.sheet.name)]: value }))}
          onOpen={onOpen}
          busy={pending}
        />
      ))}
    </>
  );
}

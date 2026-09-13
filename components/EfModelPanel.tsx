'use client';

import { useEffect, useState } from 'react';
import type { SqlColumn } from '@/lib/sql';
import {
  buildEfModel,
  DEFAULT_EF_OPTIONS,
  efFileName,
  type EfOptions,
} from '@/lib/efmodel';
import { formatInt } from '@/lib/format';
import { Panel } from './Panel';
import { ScriptBox } from './ScriptBox';

export function EfModelPanel({ columns }: { columns: SqlColumn[] }) {
  const [options, setOptions] = useState<EfOptions>(DEFAULT_EF_OPTIONS);
  const [model, setModel] = useState<string | null>(null);

  const set = <K extends keyof EfOptions>(key: K, value: EfOptions[K]) =>
    setOptions((prev) => ({ ...prev, [key]: value }));

  // The model is a snapshot: drop it whenever the data or the options move, so
  // what is on screen always matches what produced it.
  useEffect(() => setModel(null), [columns, options]);

  return (
    <Panel
      id="ef-model"
      title="EF model (C#)"
      defaultOpen={false}
      meta={
        model
          ? `${formatInt(columns.length)} mapped properties`
          : `${formatInt(columns.length)} columns ready to map`
      }
    >
      <div className="toolbar ef-toolbar">
        <label className="field">
          Source / TPA
          <input
            type="text"
            value={options.tpa}
            spellCheck={false}
            onChange={(e) => set('tpa', e.target.value)}
            title="Substituted for {TPA} in the namespace and registry, and used as the class prefix and TPAName."
          />
        </label>

        <label className="field">
          Entity
          <input
            type="text"
            value={options.entity}
            spellCheck={false}
            onChange={(e) => set('entity', e.target.value)}
            title="The table name and the class-name suffix."
          />
        </label>

        <label className="field grow">
          Namespace
          <input
            type="text"
            value={options.namespaceTemplate}
            spellCheck={false}
            onChange={(e) => set('namespaceTemplate', e.target.value)}
          />
        </label>

        <label className="field grow">
          Registry
          <input
            type="text"
            value={options.registryTemplate}
            spellCheck={false}
            onChange={(e) => set('registryTemplate', e.target.value)}
          />
        </label>

        <label className="field grow">
          Base types
          <input
            type="text"
            value={options.baseTypes}
            spellCheck={false}
            onChange={(e) => set('baseTypes', e.target.value)}
          />
        </label>

        <label className="field">
          First order
          <input
            type="number"
            min={1}
            value={options.startOrder}
            onChange={(e) => set('startOrder', Number(e.target.value) || 1)}
            title="ImportRow occupies ordinal 1, so source columns normally start at 2."
          />
        </label>

        <span className="spacer" />

        <button type="button" onClick={() => setOptions(DEFAULT_EF_OPTIONS)}>
          Reset
        </button>
        <button type="button" onClick={() => setModel(buildEfModel(columns, options))}>
          {model ? 'Regenerate' : 'Generate'}
        </button>
      </div>

      <div className="panel-body">
        <p className="shape-note">
          <code>{'{TPA}'}</code> in the namespace and registry is replaced with the source name.
          Defaults are left as <code>__TPA__</code>, which is a legal C# identifier, so the file
          compiles before you rename anything. Value types are nullable throughout — a landing row
          should take the file as it arrives rather than turn a missing cell into a zero.
        </p>
        <p className="shape-note">
          Types follow the inferred SQL types, so this and the <code>CREATE TABLE</code> always
          agree. That means they share the same limitation: a <code>Quantity</code> column whose
          sample happens to hold only whole numbers infers <code>int?</code>, not{' '}
          <code>decimal?</code>. Check the numeric columns against the source specification.
        </p>

        {model ? (
          <ScriptBox
            title={efFileName(options)}
            script={model}
            filename={efFileName(options)}
            rows={Math.min(model.split('\n').length + 1, 30)}
            mime="text/plain;charset=utf-8"
            downloadLabel="Download .cs"
          />
        ) : (
          <p className="shape-note">
            Press <strong>Generate</strong> to render <code>{efFileName(options)}</code>.
          </p>
        )}
      </div>
    </Panel>
  );
}

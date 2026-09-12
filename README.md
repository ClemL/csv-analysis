# CSV Inspector

A single-page web app for parsing, profiling and understanding delimited files.
Paste a CSV — the whole file or just its first few lines — and it reports the
file's structure, column types, null counts and summary statistics.

Parsing runs entirely in the browser. No data is uploaded, and the app has no
server-side routes, no database and no third-party runtime dependencies beyond
React and Next.js.

## Features

**Input**

- Four modes: **Analyze** one file, **Compare two files** side by side,
  **Contract check** a file against the schema it has to load into, or
  **Generate sample data** from the openFDA drug directory.
- Large paste area, or drag and drop / open a local file.
- Opened files are decoded from their bytes, not assumed to be UTF-8. A
  byte-order mark wins; otherwise strict UTF-8 is tried and Windows-1252 is the
  fallback, with a notice saying so and a manual override. This matters: reading
  a Windows-1252 extract as UTF-8 turns `Café` into `Caf<?>` and carries the
  corruption into the generated SQL.
- Every section collapses from its header, and the open/closed state is
  remembered per browser via `localStorage`. Parse settings sit outside the
  Input section's collapse, since they change what every other section reports.
  The Input section is pinned open while there is nothing to analyze.

**Delimiters**

- Comma `,`, pipe `|`, triple pipe `|||`, tab `\t` and semicolon `;`.
- Auto-detection scores every candidate against the first 50 lines on row-to-row
  field-count consistency, penalizing delimiters that manufacture empty fields.
  That penalty is what keeps `|` from beating `|||` on triple-pipe data, where
  splitting on a single pipe is perfectly consistent but wrong.
- Manual override in the toolbar.

**Parsing**

- RFC 4180 quoting: quoted fields may contain delimiters, newlines and doubled
  quotes (`""`).
- CRLF and LF line endings; a trailing newline does not create a phantom row.
- The first line is treated as a header by default; blank and duplicate header
  names are backfilled (`column_3`) and suffixed (`id_2`) so every column stays
  addressable.

**Reported statistics**

| Scope | Reported |
| --- | --- |
| File | Detected delimiter, data rows, physical lines, columns, total cells, populated cells, null/empty cells, character count, byte size, whether quoting was used, blank lines skipped |
| Record | Row 1 rendered as key/value pairs, copyable as JSON |
| Column | Inferred type, fill rate, null/empty count (split into blanks and null tokens), distinct count, min/max range, mean / median for numerics, min/max/avg length for text, date range, five most common values, whether it can serve as a key, and the values that do not fit its type |
| Preview | First 50 data rows in a scrollable table, with empty and whitespace-only cells marked |

**Azure SQL** — an optional "SQL types (Azure SQL)" setting adds an inferred
T-SQL type per column and a script generator. See below.

**Keys and duplicates** — columns that are unique and fully populated are marked
`key`; rows that repeat an earlier row field-for-field are counted, with the most
repeated shown. "What is the grain, and are there duplicates" is the first
question anyone asks of a vendor extract.

**Values that do not fit their type** — type inference needs 95% agreement, which
on a 20,000-row profile leaves room for up to 1,000 dissenting values that are
exactly the rows that break a load. Any column with dissenters shows a count next
to its type; clicking expands the offending values. A column that *misses* the
threshold is handled too: 93% integers lands in `text`, and the app says
`93.0% integer` and lists the 7% that are not, rather than silently calling the
column text.

**Possible PHI or personal data** — columns that look like SSNs, dates of birth,
medical record numbers, member or patient identifiers, NPIs, emails, phone
numbers, names or addresses raise a banner and a `phi?` badge. Header names and
value patterns are both used, and the rules are written to avoid false positives:

- **Name columns need a person qualifier.** `first_name`, `patient_name`,
  `lastname` and a column called exactly `name` flag; `brand_name`,
  `generic_name`, `labeler_name`, `pharmacy_name` and `file_name` do not. A rule
  that matched any `_name` suffix flagged every drug column in an NDC extract.
- **Identifier rules are anchored on both sides.** `patient_id` and `chart_no`
  flag; `patient_notes` and `chart_notes` do not.
- **NPIs are validated** by their Luhn check digit against the `80840` issuer
  prefix, so an arbitrary ten-digit column does not flag.
- **SSN and phone patterns require real formatting**, so a bare run of digits — an
  account number, an NDC, a claim ID — does not flag.
- **A postal code alone is not identifying**, only in company with something
  else.

**Data-quality warnings**

- Rows whose field count differs from the header (with line numbers).
- Unterminated quoted fields — the usual sign of a paste truncated mid-record.
- Duplicate header names, columns that are entirely empty, single-column results
  (a wrong delimiter), and newlines embedded inside quoted fields.

**Type inference** classifies a column as `integer`, `decimal`, `boolean`, `date`,
`text` or `empty` when at least 95% of its non-null values agree, so a handful of
dirty cells does not hide a column's real type. Numbers written with thousands
separators (`1,234.50`), a currency prefix (`$99`) or accounting negatives
(`(88.20)`) are read as numeric.

**Null handling** counts empty strings as missing always, and `NULL`, `NA`,
`N/A`, `NIL`, `NONE`, `NAN`, `\N`, `#N/A` and `UNDEFINED` as missing when the
"treat NULL/NA/N/A as null" toggle is on. The column table separates the two.

## Generate mode

Builds a delimited file from the [openFDA National Drug Code
directory](https://open.fda.gov/apis/drug/ndc/), so there is real data to try
the analyzer on without pasting anything of your own.

Search by brand name, generic name, labeler or dosage form (or leave it blank for
anything), then choose a shape:

- **Claims extract** — synthetic claim rows against real NDCs: `claim_id`,
  `member_id`, `fill_date`, `ndc`, `brand_name`, `generic_name`, `quantity`,
  `days_supply`, `unit_cost`, `total_cost`, `pharmacy`, `covered_entity`. The
  drug data is genuine; members, costs and dates are fabricated. This shape
  exercises every column type the profiler infers, and trips the PHI banner on
  `member_id`, which is the point of a demo file.
- **NDC directory** — the openFDA product records as they come: NDC, names,
  labeler, dosage form, route, ingredient and strength, packaging.

Row count, output delimiter and a seed are all adjustable; the same seed
reproduces the same file. **Add imperfections** injects blank cells, a `NULL`
token, a value that breaks its column's type, a field needing quotes, one short
row and one exact duplicate — so every warning the analyzer can raise has
something to find. The result can be copied, downloaded, or pushed straight into
Analyze or either side of Compare.

### The one network request

This is the only request the application makes. It is outbound only and carries
nothing but the search term; pasted and opened files are never transmitted. Two
consequences worth knowing:

- openFDA allows **240 requests per minute and 1,000 per day per IP address**
  without an API key. A 429 is reported as a rate limit, not a generic failure.
- `limit` is capped at 1,000 records per request, so asking for more rows than
  that cycles the returned records rather than fetching more.
- If you add a `Content-Security-Policy`, `connect-src` must allow
  `https://api.fda.gov` rather than `'none'`. Everything else stays local.

openFDA answers "no matches" with an HTTP 404 rather than an empty result set, so
that case is reported as "No products matched that search" instead of an error.

Every field of the response is treated as optional. A record with no
`brand_name`, `packaging` or `active_ingredients` produces blank cells rather
than a crash.

## Contract check

Paste an EF landing model or a `CREATE TABLE`, paste the file, and get a verdict
before you attempt the load. The two contract formats are detected
automatically and reduced to the same column list, so the checks are identical
either way.

What it reports:

| Finding | Severity | Meaning |
| --- | --- | --- |
| Too long | error | Values exceed the declared `MaxLength` or `VARCHAR(n)`. Reports how many, how long the longest is, and shows the offenders. |
| Will not convert | error | Values that cannot be parsed into the declared type — `PENDING` in an `int?`. |
| Null in NOT NULL | error | Nulls or blanks in a column declared `[Required]` or `NOT NULL`. |
| Missing column | error | The contract expects a column the file does not have. |
| Extra column | warning | The file has a column the contract does not. |
| Out of order | warning | The column is present but at a different position; `[Column(Order = n)]` is positional. |
| Matched loosely | warning | Matched only after ignoring case and separators, e.g. `patient_last_name` to `PatientLastName`. |

The verdict tile reads **Loads**, **Check** or **Will fail** — errors are the
ones that break a load, warnings are worth reading.

### What the parsers read

From an EF model: the class, `[Table]` and `Schema`, and for each property the
`[Column]` name and `Order`, `[MaxLength]` or `[StringLength]`, `[Required]`,
and the CLR type. `[NotMapped]` properties are skipped, and the source column
name is kept distinct from the C# property name — the file has to match
`[Column("StoreIdentifier")]`, not `StoreID`.

From a `CREATE TABLE`: schema, table, and for each column the type, length and
nullability. Constraints, keys and indexes are skipped, and a `DECIMAL(8,2)`
precision is not mistaken for a string length.

Both parsers are deliberately forgiving, since they read hand-written source.
Anything unrecognized — a navigation property, an exotic column type — is
reported as a parser warning rather than failing the whole contract.

## EF model generation

Alongside the SQL script, an **EF model (C#)** section emits a landing-row
entity in the same shape as the hand-written ones: a `partial class` deriving
from `ImportRow`, a `[ConnectionString]` and `[Table]` pair pointing at a
registry entry, one `[Column]` per source field carrying its ordinal,
`[MaxLength]` on string properties only, and a `[NotMapped]` TPA name. Copy it
or download it as a `.cs`.

Six fields drive it, all editable: source/TPA name, entity, namespace, registry,
base types and the first ordinal. `{TPA}` in the namespace and registry
templates is substituted with the source name, so renaming the source updates
the namespace, the registry, the class name, the `TPAName` value and the
download filename together. The defaults leave `__TPA__` in place — a legal C#
identifier, so the file compiles before anything is renamed.

Ordinals start at **2** by default, leaving 1 to `ImportRow`.

### Property naming

Source column names become PascalCase properties with acronyms title-cased, which
is what the hand-written models do: `NDC` → `Ndc`, `PrescriberNPI` →
`PrescriberNpi`, `PrescriberDEA` → `PrescriberDea`. `ID` is the exception and
keeps its casing, as in `StoreID`. A name cannot begin with a digit, so a leading
numeric run moves to the end: `340BID` → `ID340B`, `2024Total` → `Total2024`. The
`[Column]` attribute always carries the original header verbatim, so the mapping
survives the rename. Duplicates are suffixed, and a property is renamed if it
would collide with its own class name, which C# forbids.

### Type mapping

| Inferred SQL type | C# |
| --- | --- |
| `BIT` | `bool?` |
| `TINYINT`, `SMALLINT`, `INT` | `int?` |
| `BIGINT` | `long?` |
| `DECIMAL(p,s)` | `decimal?` |
| `FLOAT` | `double?` |
| `DATE`, `DATETIME2(n)` | `DateTime?` |
| `DATETIMEOFFSET(n)` | `DateTimeOffset?` |
| `UNIQUEIDENTIFIER` | `Guid?` |
| `VARCHAR(n)`, `NVARCHAR(n)` | `string` with `[MaxLength(n)]` |
| `VARCHAR(MAX)`, `NVARCHAR(MAX)` | `string`, no `[MaxLength]` |

Value types are nullable throughout: a landing row should take the file as it
arrives rather than turn a missing cell into a zero.

Types come from the same inference as the `CREATE TABLE`, so the two always
agree — including the same limitation. A `Quantity` column whose sample happens
to hold only whole numbers infers `int?`, not `decimal?`. Check numeric columns
against the source specification before committing the model.

**Identifier columns are exempt.** A column the scan recognizes as an NPI, SSN,
member number, medical record number, phone or postal code keeps a character
type however numeric it looks, in both the DDL and the model. A valid NPI is ten
digits and would otherwise land in an `INT`; nothing arithmetic is ever done to
it, and a fixed-width code loses its shape in an integer column.

## Compare mode

Two pastes, parsed under the same settings, for reconciling the same period from
two sources.

- **Schema** — columns only in A, only in B, and how each shared column moved:
  type changes, fill-rate drift over one percentage point, distinct counts, and
  for numerics the range, mean and sum.
- **Rows** — matched on a column that is unique and fully populated on both
  sides, chosen automatically or picked from the dropdown. Reports how many rows
  are in both, which keys are only in A, which only in B, and — the useful part —
  rows present on both sides whose other fields disagree, field by field.
- If the chosen column repeats within a side it is not really a key, and the app
  says so rather than quietly comparing the first row it saw.

## SQL script generation

With the "SQL types (Azure SQL)" setting on, the column table gains a **SQL type**
column (hover a cell for the reasoning), and a **SQL script** panel appears. Enter
a target table — `dbo.ImportedData` by default, schema-qualified names accepted —
and press **Generate** to fill two read-only boxes: a `CREATE TABLE` sized to the
inferred types, and `INSERT` statements carrying every row. Both can be copied or
downloaded as `.sql`.

### Type mapping

| Profiled as | Emitted type | Chosen by |
| --- | --- | --- |
| boolean | `BIT` | only true/false/yes/no/t/f/y/n values |
| integer | `TINYINT`, `SMALLINT`, `INT`, `BIGINT` | the observed min/max range |
| integer, >18 digits | `DECIMAL(n,0)` | too wide for `BIGINT` |
| decimal | `DECIMAL(p,s)` | max integer digits + max decimal places, plus two digits of headroom |
| decimal, scientific notation | `FLOAT` | exponents cannot be sized as a decimal |
| date, no time | `DATE` | no time component in any value |
| date + time | `DATETIME2(n)` | `n` = observed fractional-second digits |
| date + UTC offset | `DATETIMEOFFSET(n)` | a trailing `Z` or `±hh:mm` |
| GUID | `UNIQUEIDENTIFIER` | every value matches the GUID form |
| text | `VARCHAR(n)` / `NVARCHAR(n)` | `NVARCHAR` only when non-ASCII characters are present; `n` is the longest value rounded up to the next bucket (10, 20, 50, 100, 200, 255, 500, 1000, 2000, 4000, 8000, `MAX`) |
| no values at all | `NVARCHAR(255) NULL` | nothing to infer from |

A column is `NOT NULL` only when nothing in the sample was missing.

### Staging widths

The **Staging widths** toggle widens every inference for a landing table: one
more length bucket, four extra digits of decimal precision instead of two, the
next integer width up, and every column nullable. A staging table's job is to
accept the file, not to reject rows the sample did not predict.

Two cases deserve attention because they are the usual way a CSV import loses
data silently:

- **Zero-padded identifiers.** `02476` is a zip code, not the number 2476. Any
  column whose values carry leading zeros profiles as text and lands in a
  character type, so the padding survives.
- **Sample-sized columns.** Types come from what was pasted. Bucketed lengths and
  the two extra decimal digits give headroom, but a 20-row sample cannot know the
  longest value in a 2-million-row file. Widen before a production load.

### Literals

Values are written to match the inferred type: numbers are emitted unquoted with
currency symbols, thousands separators and accounting parentheses stripped
(`$1,204.55` → `1204.55`, `(88.20)` → `-88.20`) and the digits otherwise
untouched, so precision survives; booleans become `1`/`0`; strings are quoted with
`''` escaping and an `N` prefix on Unicode columns; nulls and blanks become
`NULL`. A value that cannot be represented in its column's type — a stray word in
a numeric column — is written as `NULL` and counted in a warning above the script.

Rows are batched 1,000 at a time, T-SQL's limit for a multi-row `VALUES` clause.
`GO` separators are included for SSMS, Azure Data Studio and `sqlcmd`; strip them
if you are running the script through a driver such as `SqlClient`. The
`DROP TABLE` guard is emitted commented out — a generated script tends to get
pasted into whichever connection happens to be open.

## Running locally

```bash
npm install
npm run dev      # http://localhost:3000
```

Other scripts:

```bash
npm run build      # production build
npm start          # serve the production build
npm test           # unit tests for the parser and profiler (node:test)
npm run typecheck  # tsc --noEmit
```

## Deploying to Vercel

The app is a stock Next.js App Router project, so Vercel needs no configuration:
import the repository at [vercel.com/new](https://vercel.com/new) and accept the
detected framework preset (build command `next build`, output `.next`). Both
routes prerender as static content, so it runs on the free tier with no
serverless functions.

From the CLI instead:

```bash
npm i -g vercel
vercel          # preview deployment
vercel --prod   # production deployment
```

## Project layout

```
app/
  layout.tsx        root layout and metadata
  page.tsx          server component shell
  globals.css       all styling (light and dark, no CSS framework)
  icon.svg          favicon
components/
  Analyzer.tsx      client component: input, toolbar, state
  Panel.tsx         collapsible section with remembered state
  Menu.tsx          dropdown menu button
  InputPanel.tsx    paste area, file opening and byte decoding
  CompareView.tsx   schema and row reconciliation between two datasets
  GeneratorView.tsx openFDA search, sample shaping and output
  EfModelPanel.tsx  EF entity generation and its placeholders
  ContractView.tsx  contract input, findings and the column-by-column table
  ScriptBox.tsx     read-only generated file with copy and download
  useDataset.ts     parse, profile, SQL types and PHI scan for one dataset
  Overview.tsx      file-level tiles and data-quality notices
  FirstRecord.tsx   row 1 as key/value pairs
  ColumnStats.tsx   per-column profile table
  DataPreview.tsx   scrollable row preview
  SqlPanel.tsx      table name, generate button, read-only script boxes
lib/
  csv.ts            parser and delimiter detection
  stats.ts          type inference and column profiling
  sql.ts            Azure SQL type inference and script generation
  encoding.ts       byte-order marks and encoding fallback
  phi.ts            PHI and personal-identifier heuristics
  diff.ts           comparison of two datasets
  ndc.ts            openFDA client and sample-file generators
  efmodel.ts        CLR type mapping, property naming and entity rendering
  contract.ts       EF and DDL parsing, and checking a file against either
  format.ts         display formatting
tests/
  csv.test.ts       parser and profiler tests
  sql.test.ts       SQL inference and script generation tests
  encoding.test.ts  decoding and fallback tests
  phi.test.ts       identifier-detection tests, including false positives
  diff.test.ts      comparison tests
  ndc.test.ts       URL building and generator tests, against a fixture
  efmodel.test.ts   type mapping, naming rules and rendered-shape tests
  contract.test.ts  parser and check tests, against a real landing model
  fixtures/         a captured openFDA response, so tests need no network
```

## Limits

- Input over 5,000,000 characters is clipped, and the app says so.
- `INSERT` generation covers the first 5,000 data rows; past that the script
  stops being something you would paste by hand, and the app says how many rows
  were left out.
- Column profiling covers the first 20,000 data rows; row and line counts still
  reflect the whole input, and the app reports when profiling was capped.
- Parsing is synchronous on the main thread. 100,000 rows (~4.4 MB) parse and
  profile in roughly 350 ms; React's `useDeferredValue` keeps typing responsive
  above that.

import { Analyzer } from '@/components/Analyzer';

export default function Home() {
  return (
    <main className="page">
      <header className="masthead">
        <h1>CSV Inspector</h1>
        <p>
          Paste a delimited file — or just its first few lines — to see its structure, column types,
          null counts and summary statistics. Comma, pipe, triple pipe, tab and semicolon delimiters
          are supported, with automatic detection. Nothing is uploaded; parsing runs entirely in your
          browser.
        </p>
      </header>
      <Analyzer />
      <p className="footer">
        The first line is treated as a header unless you turn that off. Quoted fields follow RFC 4180
        rules: delimiters, newlines and doubled quotes inside quotes are preserved.
      </p>
    </main>
  );
}

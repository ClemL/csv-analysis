import { Analyzer } from '@/components/Analyzer';

export default function Home() {
  return (
    <main className="page">
      <Analyzer />
      <p className="footer">
        The first line is treated as a header unless you turn that off. Quoted fields follow RFC 4180
        rules: delimiters, newlines and doubled quotes inside quotes are preserved. Nothing is
        uploaded; parsing runs entirely in your browser.
      </p>
    </main>
  );
}

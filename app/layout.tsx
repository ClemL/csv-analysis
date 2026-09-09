import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CSV Inspector — parse, profile and understand delimited data',
  description:
    'Paste a CSV, pipe-, triple-pipe- or tab-delimited file and get structure, column types, null counts and summary statistics instantly. Everything is parsed in your browser.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

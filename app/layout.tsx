import type { Metadata } from 'next';
import { IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// Downloaded at build time and served from the bundle, so the desktop app
// needs no network for them and its `font-src 'self'` policy holds.
const plex = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'CSV Inspector — parse, profile and understand delimited data',
  description:
    'Paste a CSV, pipe-, triple-pipe- or tab-delimited file and get structure, column types, null counts and summary statistics instantly. Everything is parsed in your browser.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plex.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}

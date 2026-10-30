import { readFileSync } from 'node:fs';

/**
 * The desktop build loads the app from disk rather than from a Next.js server,
 * so it emits a fully static bundle into `out/` instead of the usual `.next/`
 * server output. Nothing in this app renders on the server — every component is
 * a client component and all parsing happens in the browser — so the web and
 * desktop builds produce identical behavior.
 *
 * `npm run desktop:build` selects it via `npm_lifecycle_event`, which npm sets
 * on every platform; setting `DESKTOP_BUILD=1` works too, for CI that calls
 * `next build` directly. The plain `npm run build` used by the Vercel
 * deployment is unaffected.
 */
const desktop =
  process.env.DESKTOP_BUILD === '1' || process.env.npm_lifecycle_event === 'desktop:build';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * Stamped once at build time and inlined into the bundle, so the footer shows
 * the same string in the prerendered HTML and on the client. Formatting a date
 * at render time instead would differ by timezone and break hydration.
 */
const buildTime = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_TIME: buildTime,
  },
  ...(desktop
    ? {
        output: 'export',
        // The desktop shell serves `out/` over a custom `app://` scheme, so the
        // absolute `/_next/...` URLs in the export resolve correctly.
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;

// Copies src/ into dist/. Everything shipped is listed explicitly.
import { rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

const files = [
  'index.html',
  'register.json',
  'css/tokens.css',
  'css/site.css',
  'js/core.js',
  'js/motion.js',
  'js/market.js',
  'js/app.js',
  'assets/favicon.svg',
  'assets/logo-192.png',   // header, footer, console
  'assets/logo-512.png',   // hero
];

rmSync(dist, { recursive: true, force: true });
for (const f of files) {
  const from = join(src, f);
  if (!existsSync(from)) { console.error('missing source file', f); process.exit(1); }
  mkdirSync(dirname(join(dist, f)), { recursive: true });
  copyFileSync(from, join(dist, f));
}

writeFileSync(join(dist, '_headers'), [
  '/*',
  "  Content-Security-Policy: default-src 'self'; img-src 'self' https: data:; connect-src 'self' https://api.dexscreener.com; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: no-referrer',
  '/register.json',
  '  Cache-Control: no-cache',
  '',
].join('\n'));

// the logo must be shipped and referenced with a relative path
const html = readFileSync(join(dist, 'index.html'), 'utf8');
for (const logo of ['assets/logo-192.png', 'assets/logo-512.png']) {
  if (!existsSync(join(dist, logo))) { console.error('logo not in dist', logo); process.exit(1); }
  if (!html.includes(`src="${logo}"`)) { console.error('index.html does not reference', logo); process.exit(1); }
}
console.log(`dist/ ready: ${files.length + 1} files`);

// Gate runner. Exit 0 only when every gate passes.
// Mutation anchors are state-independent: each test reads the current record
// at runtime and forces BOTH branches, so the result never depends on what the
// register happens to say today.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { bigramHashes, copyStrings } from '../tools/bigrams.mjs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => join(root, ...a);
const read = (...a) => readFileSync(P(...a), 'utf8');
const core = await import(pathToFileURL(P('dist/js/core.js')).href);

const results = [];
const gate = (name, fn) => {
  try { const detail = fn(); results.push({ name, ok: true, detail: detail || '' }); }
  catch (e) { results.push({ name, ok: false, detail: e.message }); }
};
const must = (c, msg) => { if (!c) throw new Error(msg); };

const walk = (dir) => readdirSync(dir).flatMap((n) => { const f = join(dir, n); return statSync(f).isDirectory() ? walk(f) : [f]; });
const distFiles = existsSync(P('dist')) ? walk(P('dist')).map((f) => relative(P('dist'), f).replace(/\\/g, '/')) : [];
const textExt = new Set(['.html', '.css', '.js', '.svg', '.json']);
const distText = (skip = []) => distFiles.filter((f) => textExt.has(extname(f)) && !skip.includes(f)).map((f) => [f, read('dist', f)]);

// ---- fixtures: real-shaped test values, used only in memory ----
const SOL_A = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const SOL_B = '9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT';
const EVM_A = '0x52908400098527886E0F7030069857D2E4169EE7';
const EVM_B = '0x8617E340B3D01FA5F11F306F4090FD50E238070D';
const real = JSON.parse(read('dist/register.json'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const forced = {
  stated: { ca: { value: SOL_A }, x: { url: 'https://x.com/npc_test' }, github: { url: 'https://github.com/npc-test' }, chain: { value: 'Solana' }, rpc: { url: 'https://solana-rpc.publicnode.com' }, market: { url: 'https://api.dexscreener.com' } },
};
// Read the CURRENT record, then force it to the requested state.
function mutate(reg, id, state, payload) {
  const out = clone(reg);
  const cur = out.records.find((r) => r.id === id);
  must(cur, `record ${id} missing`);
  delete cur.value; delete cur.url;
  cur.state = state;
  if (state === 'stated') Object.assign(cur, payload || forced.stated[id]);
  return out;
}
const INERT = ['absent', 'unconfirmed'];

// ---- PNG decoding (8-bit RGBA/RGB, non-interlaced) for pixel provenance ----
function decodePng(buf) {
  must(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'not a PNG');
  let o = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; must(d[8] === 8 && d[12] === 0, 'unsupported PNG'); }
    if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, ct, bpp, px };
}

// ===== gates =====
gate('dist/ exists with index.html', () => { must(distFiles.includes('index.html'), 'dist/index.html missing'); return `${distFiles.length} files`; });

gate('logo files shipped in dist/, RGBA PNG, identical to source, referenced by relative path', () => {
  const html = read('dist/index.html');
  for (const n of ['logo-192.png', 'logo-512.png']) {
    const rel = `assets/${n}`;
    must(distFiles.includes(rel), `${rel} not in dist`);
    const a = readFileSync(P('dist', rel)), b = readFileSync(P('src', rel));
    must(createHash('sha1').update(a).digest('hex') === createHash('sha1').update(b).digest('hex'), `${rel} differs from src`);
    const png = decodePng(a); must(png.ct === 6, `${rel} is not RGBA`);
    must(html.includes(`src="${rel}"`), `index.html does not reference ${rel}`);
  }
  must(!/src="\//.test(html) && !/href="\//.test(html), 'absolute path in index.html');
});

gate('favicon: SVG 32x32, pixel-traced, no double hyphen anywhere', () => {
  const s = read('dist/assets/favicon.svg');
  must(/viewBox="0 0 32 32"/.test(s) && /width="32"/.test(s) && /height="32"/.test(s), 'not 32x32');
  must(!s.includes('<!--') && !s.includes('--'), 'comment or double hyphen present');
  must((s.match(/<path /g) || []).length >= 2 && (s.match(/M\d+ \d+h/g) || []).length > 50, 'not traced from a pixel grid');
  must(/href="assets\/favicon.svg"/.test(read('dist/index.html')), 'favicon not linked');
});

gate('no dates, timestamps, clocks anywhere in shipped files (register.json is data, exempt)', () => {
  const bad = [/\b(19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/, /\b\d{1,2}:\d{2}(:\d{2})?\b/, /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b/i, /\bas of\b/i, /\bchecked\b/i, /\bupdated\b/i, /\bago\b/i, /toLocale(Time|Date)String|new Date|Date\.now|toISOString|getFullYear|Intl\.DateTimeFormat/];
  for (const [f, t] of distText(['register.json'])) for (const re of bad) must(!re.test(t), `${f} matches ${re}`);
});

gate('palette: hex literals only in tokens.css; tokens are sampled pixels', () => {
  const pal = JSON.parse(read('src/palette.json')).palette;
  const palHex = new Set(pal.map((p) => p.hex));
  for (const [f, t] of distText(['css/tokens.css', 'assets/favicon.svg'])) {
    must(!/#[0-9a-fA-F]{3,8}\b/.test(t), `${f} holds a hex literal`);
    must(!/\b(rgba?|hsla?|oklch|lab)\(/.test(t), `${f} holds a colour function literal`);
  }
  const tok = read('dist/css/tokens.css');
  const hexes = [...tok.matchAll(/#[0-9a-f]{6}\b/g)].map((m) => m[0]);
  for (const h of hexes) must(palHex.has(h), `${h} not in palette.json`);
  for (const h of palHex) must(hexes.includes(h), `${h} sampled but unused`);
  for (const m of read('dist/assets/favicon.svg').matchAll(/#[0-9a-f]{6}\b/g)) must(palHex.has(m[0]), `favicon fill ${m[0]} invented`);
  let verified = 0;
  for (const p of pal) {
    must(existsSync(P(p.file)), `${p.file} missing`);
    if (p.file.endsWith('.png')) {
      const img = decodePng(readFileSync(P(p.file)));
      const i = (p.y * img.w + p.x) * img.bpp;
      const got = '#' + [0, 1, 2].map((k) => img.px[i + k].toString(16).padStart(2, '0')).join('');
      must(got === p.hex && (img.bpp === 3 || img.px[i + 3] === 255), `${p.token}: pixel (${p.x},${p.y}) is ${got}, not ${p.hex}`);
      verified++;
    }
  }
  return `${hexes.length} tokens, ${verified} verified by pixel decode, rest recorded by prep script`;
});

gate('register: valid states, inert records carry no value or url', () => {
  const problems = core.validateRegister(real); must(!problems.length, problems.join('; '));
  must(distFiles.includes('register.json') && read('dist/register.json') === read('src/register.json'), 'dist register differs');
  for (const r of real.records) { must(r.source && r.scope, `${r.id}: source/scope missing`); }
  for (const id of ['chain', 'rpc', 'market', 'ca', 'x', 'github']) must(core.getRecord(real, id), `${id} record missing`);
  // mutation: an inert record that gains a value must be reported
  for (const st of INERT) { const bad = clone(real); const r = bad.records.find((x) => x.id === 'x'); r.state = st; r.url = 'https://x.com/a'; must(core.validateRegister(bad).length, 'validator missed inert value'); }
});

gate('link rule: href only for stated records, handle derived from stored url (both branches)', () => {
  for (const kind of ['x', 'github']) {
    for (const st of INERT) { const v = core.socialView(core.getRecord(mutate(real, kind, st), kind), kind); must(!v.active && !v.href, `${kind}/${st} produced a link`); }
    const reg = mutate(real, kind, 'stated'); const rec = core.getRecord(reg, kind);
    const v = core.socialView(rec, kind);
    must(v.active && v.href === new URL(rec.url).href, `${kind} stated has no href`);
    must(v.handle === '@' + new URL(rec.url).pathname.split('/')[1], `${kind} handle not derived from url`);
    const wrongHost = mutate(real, kind, 'stated', { url: 'https://evil.example/x' }); must(!core.socialView(core.getRecord(wrongHost, kind), kind).active, `${kind} accepted a foreign host`);
  }
  const html = read('dist/index.html');
  must(!/href="https?:\/\/(www\.)?(x|twitter|github)\.com/i.test(html), 'static html carries a social href');
});

gate('social icons: top-right in header, both present, icon only, official marks', () => {
  const html = read('dist/index.html');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  const nav = header.slice(header.indexOf('<nav'));
  must(nav.indexOf('data-social="x"') > 0 && nav.indexOf('data-social="github"') > nav.indexOf('data-social="x"'), 'social order/location');
  must(nav.trimEnd().endsWith('</nav>') && nav.lastIndexOf('data-social') > nav.lastIndexOf('class="nav-cta"'), 'socials are not the right-most items');
  for (const k of ['x', 'github']) {
    const m = header.match(new RegExp(`<span class="social[^"]*" data-social="${k}"[^>]*>([\\s\\S]*?)</span>`)); must(m, `${k} node missing`);
    must(m[1].replace(/<svg[\s\S]*?<\/svg>/g, '').trim() === '', `${k} carries a text label`);
  }
  must(html.includes('M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.4l7.1-8.2L.8 2h6.5l4.5 6.8L18.9 2Z'), 'X mark path');
  must(html.includes('M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59'), 'GitHub octicon path');
  const css = read('dist/css/site.css');
  must(!/\.social[^{]*\{[^}]*display:none/.test(css), 'a social icon is hidden at some breakpoint');
  must(/\.social\{[^}]*width:44px;height:44px/.test(css), 'social tap target below 44');
});

gate('CA slot: large top slot, full address when stated, inert + "pending" otherwise (both branches)', () => {
  for (const st of INERT) {
    const v = core.caView(core.getRecord(mutate(real, 'ca', st), 'ca'));
    must(!v.active && v.text === 'pending', `ca/${st} not inert`);
  }
  for (const value of [SOL_A, EVM_A]) {
    const v = core.caView(core.getRecord(mutate(real, 'ca', 'stated', { value }), 'ca'));
    must(v.active && v.text === value, 'stated CA not shown in full');
  }
  must(!core.caView(core.getRecord(mutate(real, 'ca', 'stated', { value: 'not an address' }), 'ca')).active, 'garbage CA accepted');
  const html = read('dist/index.html');
  const slot = html.slice(html.indexOf('data-ca-slot'), html.indexOf('</section>', html.indexOf('data-ca-slot')));
  must(html.indexOf('data-ca-slot') < html.indexOf('<main'), 'CA slot is not at top');
  must(/data-ca-copy disabled/.test(slot) && />pending</.test(slot) && !core.addressPattern().test(slot), 'static CA slot not inert');
  must(/clamp\(17px,2\.5vw,30px\)/.test(read('dist/css/site.css')), 'CA font size not large');
  const app = read('dist/js/app.js'); must(/navigator\.clipboard|copyText/.test(app) && /Copied/.test(app), 'no click-to-copy feedback');
});

gate('gate warning: 0x hex never blanket-rejected; address-shaped strings matched to stated registry; CA exempt', () => {
  const reg = mutate(real, 'ca', 'stated', { value: SOL_A });
  must(core.checkAddress(SOL_A, reg).kind === 'registered', 'stated Solana CA not matched');
  must(core.checkAddress(SOL_B, reg).kind === 'unregistered', 'look-alike not flagged');
  must(core.checkAddress(EVM_B, reg).kind === 'unregistered' && core.checkAddress(EVM_B, reg).shape === 'evm', '0x string was rejected by shape');
  const regEvm = mutate(real, 'ca', 'stated', { value: EVM_A });
  must(core.checkAddress(EVM_A, regEvm).kind === 'registered' && core.checkAddress(EVM_A.toLowerCase().replace('0x', '0x'), regEvm).kind === 'registered', 'stated 0x not matched (case-insensitive)');
  for (const st of INERT) { const r = mutate(real, 'ca', st); must(core.checkAddress(SOL_A, r).kind === 'unregistered', `inert ca matched something (${st})`); must(core.checkAddress('hello', r).kind === 'not-address', 'plain text treated as address'); }
  const scan = core.scanText(`see ${SOL_A} and ${EVM_B} and ${SOL_B}`, reg);
  must(scan.length === 3 && scan[0].status === 'registered' && scan[1].status === 'unregistered' && scan[2].status === 'unregistered', 'scanText statuses');
  must(/data-scan-exempt/.test(read('dist/index.html').split('data-ca-slot')[1].split('>')[0]), 'CA slot is not scanner-exempt');
  must(/\[data-scan-exempt\]/.test(read('dist/js/app.js')), 'page scan does not honour the exemption');
});

gate('market: follows only the market record; CA state has zero effect (both branches)', () => {
  for (const ca of ['stated', ...INERT]) {
    for (const m of ['stated', ...INERT]) {
      const reg = mutate(mutate(real, 'ca', ca), 'market', m);
      must(core.marketEnabled(reg) === (m === 'stated'), `marketEnabled wrong for ca=${ca}, market=${m}`);
    }
  }
  const src = read('dist/js/market.js');
  must(!/caView|'ca'|"ca"/.test(src), 'market.js touches the CA record');
  must(/marketEnabled\(reg\)/.test(src) && /getRecord\(reg, 'market'\)/.test(src), 'market not driven by its record');
});

gate('market behaviour: endpoints, top 10 by volume, fallback tile, backoff, 60s poll, visibility pause', () => {
  const s = read('dist/js/market.js');
  for (const need of ['/token-boosts/top/v1', '/tokens/v1/solana/', "chainId === 'solana'", 'p.info && p.info.imageUrl', 'b.volume - a.volume', 'slice(0, 10)', 'tok-tile', "addEventListener('error', tile", '2 ** n', 'POLL_MS = 60000', "document.hidden", "visibilitychange", 'lastGood', "'—'", 'data-copy', 'is-skeleton', 'countTo']) must(s.includes(need), `market.js lacks ${need}`);
  must(/Error: the market feed/.test(s), 'no visible error text');
  const html = read('dist/index.html'); must(html.includes('data-ticker-track') && /ticker-track\{[^}]*animation:marquee/.test(read('dist/css/site.css')), 'ticker missing');
});

gate('motion: damped spring solver, parallax, spotlight, progress bar, pulse, count-up flash, skeleton', () => {
  const m = read('dist/js/motion.js'), css = read('dist/css/site.css'), html = read('dist/index.html');
  must(/-k \* \(x - 1\) - c \* v/.test(m), 'no damped spring term');
  for (const need of ['initParallax', 'pointermove', 'initSpotlight', 'initProgress', 'flash-up', 'flash-down']) must(m.includes(need), `motion.js lacks ${need}`);
  for (const need of ['.spot::after', '@keyframes pulse', '@keyframes shimmer', '@keyframes drift', '.progress{position:fixed']) must(css.includes(need), `css lacks ${need}`);
  must(html.includes('data-parallax') && html.includes('data-progress') && /data-depth/.test(html) && html.includes('dot live'), 'markup lacks motion hooks');
});

gate('prefers-reduced-motion: every animation and transition disabled, JS honours it', () => {
  const css = read('dist/css/site.css');
  const blk = css.slice(css.indexOf('@media(prefers-reduced-motion:reduce)'));
  must(/animation:none!important/.test(blk) && /transition:none!important/.test(blk), 'reduced block does not zero motion');
  for (const f of ['motion.js', 'market.js']) must(/reduced/.test(read('dist/js', f)), `${f} ignores reduced motion`);
  must(/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(read('dist/js/motion.js')), 'no matchMedia');
});

gate('no ch units; 44px tap targets declared', () => {
  for (const [f, t] of distText()) if (/\.(css|html)$/.test(f)) must(!/\d(\.\d+)?ch\b/.test(t), `${f} uses ch units`);
  const css = read('dist/css/site.css');
  for (const sel of ['.nav-link,.nav-cta', '.button{', '.icon-btn{', 'summary{', '.text-link{', 'input[type=text]{']) {
    const i = css.indexOf(String.fromCharCode(10) + sel) + 1; must(i >= 1, `${sel} missing`);
    must(/min-height:4[48]px|width:44px;height:44px/.test(css.slice(i, css.indexOf('}', i))), `${sel} lacks 44px target`);
  }
});

gate('no outbound URLs baked into code except the SVG namespace', () => {
  for (const [f, t] of distText(['register.json', 'assets/favicon.svg'])) {
    const urls = [...t.matchAll(/https?:\/\/[^\s"'`)<>]+/g)].map((m) => m[0]).filter((u) => !u.startsWith('http://www.w3.org/'));
    must(!urls.length, `${f}: ${urls.join(', ')}`);
  }
});

gate('JS parses (node --check)', () => {
  for (const f of distFiles.filter((x) => x.endsWith('.js'))) execFileSync(process.execPath, ['--check', P('dist', f)], { stdio: 'pipe' });
  return `${distFiles.filter((x) => x.endsWith('.js')).length} modules`;
});

gate('repo hygiene: no agent files, no attribution strings anywhere', () => {
  must(!existsSync(P('CLAUDE.md')) && !existsSync(P('.claude')), 'agent config present');
  const words = [['cla', 'ude'], ['anthr', 'opic'], ['chat', 'gpt'], ['gener', 'ated (with|by)'], ['co-auth', 'ored-by'], ['artificial ', 'intelligence']].map((p) => p.join(''));
  const re = new RegExp(`${words.join('|')}|\\bA\\.?I\\b`, 'i');
  const skip = new Set(['node_modules', 'brand', 'reference', '.git']);
  const scan = (dir) => readdirSync(dir).flatMap((n) => { if (skip.has(n)) return []; const f = join(dir, n); return statSync(f).isDirectory() ? scan(f) : [f]; });
  for (const f of scan(root)) {
    if (!textExt.has(extname(f)) && !/(README\.md|LICENSE|\.md)$/.test(f)) continue;
    if (f.endsWith('ref-bigrams.json') || f.endsWith('package-lock.json')) continue;
    must(!re.test(readFileSync(f, 'utf8')), `${relative(root, f)} matches attribution pattern`);
  }
});

gate('README, whitepaper, LICENSE at project root, not in dist', () => {
  for (const f of ['README.md', 'docs/whitepaper.md', 'LICENSE']) must(existsSync(P(f)), `${f} missing`);
  must(!distFiles.some((f) => /readme|whitepaper|license/i.test(f)), 'repo docs leaked into dist');
  const lic = read('LICENSE'); must(/MIT License/.test(lic) && /Copyright \(c\) 2026 NPC/.test(lic), 'LICENSE not MIT / NPC, 2026');
  const rd = read('README.md'); must(/img\.shields\.io|badge/i.test(rd) && /Solana/.test(rd) && /## Overview/.test(rd) && /## Features/.test(rd) && /## Links/.test(rd) && /pending/i.test(rd), 'README sections');
  const wp = read('docs/whitepaper.md'); must(/Vision/i.test(wp) && /Tokenomics/i.test(wp) && /Roadmap/i.test(wp) && /Team/i.test(wp) && (wp.match(/^### Phase/gm) || []).length >= 3, 'whitepaper sections');
});

gate('dist contains only the intended files (no brand/ or reference/ originals)', () => {
  const want = ['_headers', 'index.html', 'register.json', 'css/tokens.css', 'css/site.css', 'js/core.js', 'js/motion.js', 'js/market.js', 'js/app.js', 'assets/favicon.svg', 'assets/logo-192.png', 'assets/logo-512.png'].sort();
  must(JSON.stringify([...distFiles].sort()) === JSON.stringify(want), `unexpected dist listing: ${distFiles.join(', ')}`);
});

gate('copy: zero shared content-word pairs with the reference corpus', () => {
  const ref = new Set(JSON.parse(read('tools/ref-bigrams.json')));
  const parts = [read('dist/index.html'), read('dist/register.json'), read('README.md'), read('docs/whitepaper.md')];
  for (const f of ['app.js', 'market.js']) parts.push(copyStrings(read('dist/js', f)));
  const hits = [];
  for (const t of parts) for (const [pair, h] of bigramHashes(t)) if (ref.has(h)) hits.push(pair);
  must(!hits.length, `shared pairs: ${[...new Set(hits)].join(' | ')}`);
  return 'function words and numbers break a pair, so only content-word pairs count';
});

gate('no reference-only content: no miner, no coin icon, no animated logo', () => {
  const all = distText(['register.json']).map(([, t]) => t).join('\n').toLowerCase();
  for (const w of ['monero', 'randomx', 'hashrate', 'hashvault', 'xmr', '$cpu']) must(!all.includes(w), `contains "${w}"`);
});

gate('security: no inline script, no innerHTML fed by network data', () => {
  must(!/<script(?![^>]*src=)/.test(read('dist/index.html')), 'inline script');
  const m = read('dist/js/market.js');
  for (const line of m.split('\n').filter((l) => l.includes('innerHTML'))) must(!/\br\.|\bp\./.test(line), `network data in innerHTML: ${line.trim().slice(0, 60)}`);
});

// ---- report ----
let fail = 0;
results.forEach((r, i) => { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${String(i + 1).padStart(2, '0')}  ${r.name}${r.detail ? ' :: ' + r.detail : ''}`); });
console.log(`\ngates: ${results.length - fail}/${results.length} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

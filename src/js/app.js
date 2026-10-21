import { getRecord, isStated, validateRegister, caView, socialView, checkAddress, scanText, hostOf, handleFromUrl, shortAddr } from './core.js';
import { initReveal, initProgress, initParallax, initSpotlight } from './motion.js';
import { initMarket, copyText } from './market.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

async function loadRegister() {
  try {
    const r = await fetch('register.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('register');
    const reg = await r.json();
    return validateRegister(reg).length ? { records: [] } : reg;
  } catch { return { records: [] }; }
}

function renderChain(reg) {
  const rec = getRecord(reg, 'chain');
  const name = $('[data-chain-name]');
  const note = $('[data-chain-note]');
  if (isStated(rec) && rec.value) {
    name.textContent = rec.value;
    note.textContent = `Source: ${rec.source}. Scope: ${rec.scope}.`;
  } else { name.textContent = 'pending'; note.textContent = 'No network statement on record.'; }
}

function renderSocials(reg) {
  for (const kind of ['x', 'github']) {
    const node = $(`[data-social="${kind}"]`);
    const rec = getRecord(reg, kind);
    const v = socialView(rec, kind);
    node.dataset.state = rec ? rec.state : 'absent';
    if (!v.active) continue;
    const a = document.createElement('a');
    a.className = 'social'; a.href = v.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.dataset.social = kind;
    a.setAttribute('aria-label', `${rec.label} ${v.handle} (opens in a new tab)`);
    a.innerHTML = node.innerHTML;
    node.replaceWith(a);
  }
}

function renderCa(reg) {
  const rec = getRecord(reg, 'ca');
  const v = caView(rec);
  const val = $('[data-ca-value]'), btn = $('[data-ca-copy]');
  const badge = $('[data-ca-badge]'), state = $('[data-ca-state]');
  $('[data-ca-slot]').dataset.state = v.active ? 'stated' : (rec ? rec.state : 'absent');
  val.textContent = v.text;
  val.classList.toggle('is-inert', !v.active);
  btn.disabled = !v.active;
  badge.textContent = v.active ? 'STATED' : 'PENDING';
  state.textContent = v.active ? 'Matched' : 'Waiting';
  $('[data-sum-ca]').textContent = v.active ? shortAddr(v.text) : 'pending';
  $('[data-gate-note]').textContent = v.active ? 'The stated contract address is live. Anything equal to it is recognised.' : 'No contract address is stated, so no string can match it yet.';
  $('[data-mint-line]').textContent = v.active ? `Contract address: ${v.text}` : 'Contract address: pending';
  if (v.active) {
    btn.addEventListener('click', async () => {
      const ok = await copyText(v.text);
      btn.textContent = ok ? 'Copied' : 'Copy failed'; btn.classList.toggle('is-done', ok);
      $('[data-live]').textContent = ok ? 'Contract address copied' : 'Copy failed';
      clearTimeout(btn._t); btn._t = setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('is-done'); }, 1600);
    });
  }
}

function registerDisplay(rec) {
  if (!isStated(rec)) return 'pending';
  if (rec.id === 'ca') { const v = caView(rec); return v.active ? shortAddr(v.text) : 'pending'; }
  if (rec.value) return rec.value;
  if (rec.url) return rec.id === 'x' || rec.id === 'github' ? handleFromUrl(rec.url) : hostOf(rec.url);
  return 'pending';
}

function renderRegister(reg) {
  const list = $('[data-register-list]');
  list.replaceChildren();
  reg.records.forEach((rec) => {
    const li = document.createElement('li');
    li.className = 'activity-item spot'; li.dataset.record = rec.id; li.dataset.state = rec.state;
    li.dataset.reveal = '';
    const sym = document.createElement('span'); sym.className = 'activity-symbol'; sym.setAttribute('aria-hidden', 'true'); sym.textContent = rec.label.trim()[0].toUpperCase();
    const main = document.createElement('div'); main.className = 'activity-main';
    const s = document.createElement('strong'); s.textContent = rec.label;
    main.appendChild(s);
    if (isStated(rec)) { const sm = document.createElement('small'); sm.textContent = `${rec.source} · ${rec.scope}`; main.appendChild(sm); }
    const t = document.createElement('span'); t.className = 'activity-time';
    t.textContent = registerDisplay(rec);
    li.append(sym, main, t);
    list.appendChild(li);
  });
  $('[data-register-count]').textContent = `${reg.records.filter(isStated).length} of ${reg.records.length} stated`;
}

function initConsole(reg) {
  const input = $('#addrInput'), out = $('[data-verdict]'), clear = $('[data-addr-clear]');
  const set = (kind, head, body) => { out.dataset.kind = kind; out.replaceChildren(); const a = document.createElement('strong'); a.textContent = head; const b = document.createElement('span'); b.textContent = body; out.append(a, b); };
  const run = () => {
    const r = checkAddress(input.value, reg);
    if (r.kind === 'empty') set('empty', 'Waiting for input.', 'Paste something to see how the register reads it.');
    else if (r.kind === 'not-address') set('warn', 'Not address-shaped.', 'This text is neither a base58 string nor a 40-digit 0x string.');
    else if (r.kind === 'registered') set('ok', 'Matches the register.', `Equal to the stated ${getRecord(reg, r.record).label.toLowerCase()}.`);
    else set('warn', 'Unverified.', r.caStated ? `This ${r.shape === 'evm' ? '0x' : 'Solana'}-style string is not in the register. It differs from the stated contract address.` : `This ${r.shape === 'evm' ? '0x' : 'Solana'}-style string is not in the register, and no contract address is stated yet, so nothing can match.`);
  };
  input.addEventListener('input', run);
  clear.addEventListener('click', () => { input.value = ''; run(); input.focus(); });
  run();
}

function pageScan(reg) {
  const clone = document.body.cloneNode(true);
  $$('[data-scan-exempt]', clone).forEach((n) => n.remove());
  $$('script', clone).forEach((n) => n.remove());
  const hits = scanText(clone.textContent || '', reg).filter((h) => h.status === 'unregistered');
  $('[data-sum-scan]').textContent = hits.length ? `${hits.length} unverified` : 'clean';
}

async function boot() {
  initProgress(); initSpotlight(); initParallax();
  const reg = await loadRegister();
  renderChain(reg); renderSocials(reg); renderCa(reg); renderRegister(reg); initConsole(reg);
  initReveal();
  initMarket(reg);
  pageScan(reg);
}
boot();

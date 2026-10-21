import { marketEnabled, getRecord } from './core.js';
import { countTo, reduced } from './motion.js';

const POLL_MS = 60000;
const MAX_ATTEMPTS = 4;
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fmtPrice = (p) => {
  if (!Number.isFinite(p)) return '—';
  if (p >= 1) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (p >= 0.01) return '$' + p.toFixed(4);
  return '$' + p.toFixed(Math.min(12, Math.max(4, 2 - Math.floor(Math.log10(p || 1)))));
};
const fmtChange = (c) => (Number.isFinite(c) ? `${c >= 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(2)}%` : '—');
const fmtMoney = (v) => (Number.isFinite(v) ? money.format(v) : '—');

async function getJSON(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
}

async function loadTop(base) {
  const boosts = await getJSON(`${base}/token-boosts/top/v1`);
  const addrs = [...new Set((Array.isArray(boosts) ? boosts : []).filter((b) => b.chainId === 'solana' && b.tokenAddress).map((b) => b.tokenAddress))];
  if (!addrs.length) throw new Error('no solana entries');
  const chunks = [];
  for (let i = 0; i < addrs.length; i += 30) chunks.push(addrs.slice(i, i + 30));
  const batches = await Promise.all(chunks.map((c) => getJSON(`${base}/tokens/v1/solana/${c.join(',')}`)));
  const best = new Map();
  for (const p of batches.flat()) {
    if (!p || p.chainId !== 'solana' || !p.baseToken) continue;
    const a = p.baseToken.address;
    const liq = Number(p.liquidity && p.liquidity.usd) || 0;
    const cur = best.get(a);
    if (!cur || liq > (Number(cur.liquidity && cur.liquidity.usd) || 0)) best.set(a, p);
  }
  const rows = [...best.values()].map((p) => ({
    address: p.baseToken.address,
    symbol: p.baseToken.symbol || '?',
    name: p.baseToken.name || '',
    price: Number(p.priceUsd),
    change: Number(p.priceChange && p.priceChange.h24),
    volume: Number(p.volume && p.volume.h24),
    liquidity: Number(p.liquidity && p.liquidity.usd),
    img: (p.info && p.info.imageUrl) || '',
  })).filter((r) => Number.isFinite(r.volume));
  rows.sort((a, b) => b.volume - a.volume);
  const top = rows.slice(0, 10);
  if (!top.length) throw new Error('no pairs');
  return top;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fallback below */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove(); return ok;
}

const COPY_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.78.78 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .14.11.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .78 5.78 0 6.75 0h7.5C15.22 0 16 .78 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .14.11.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>';

export function initMarket(reg) {
  const list = document.querySelector('[data-market-list]');
  const track = document.querySelector('[data-ticker-track]');
  const pills = [...document.querySelectorAll('[data-market-pill]')];
  const note = document.querySelector('[data-market-note]');
  const volEl = document.querySelector('[data-stat-volume]');
  const cntEl = document.querySelector('[data-stat-count]');
  if (!list) return;

  const rec = getRecord(reg, 'market');
  const base = marketEnabled(reg) ? rec.url.replace(/\/$/, '') : null;
  const rowsByAddr = new Map();
  let lastGood = null, timer = 0, inflight = false;

  const setStatus = (state, text) => {
    pills.forEach((p) => { p.dataset.state = state; const s = p.querySelector('[data-pill-text]'); if (s) s.textContent = text; });
  };
  const setNote = (text) => { if (note) note.textContent = text; };

  const skeleton = () => {
    list.replaceChildren();
    for (let i = 0; i < 10; i++) {
      const li = document.createElement('li');
      li.className = 'mrow is-skeleton';
      li.innerHTML = '<span class="sk sk-s"></span><span class="sk-tok"><i class="sk sk-c"></i><span class="sk sk-m"></span></span><span class="sk sk-m"></span><span class="sk sk-s"></span><span class="sk sk-m"></span><span class="sk sk-m"></span><span class="sk sk-c"></span>';
      list.appendChild(li);
    }
  };

  const logoNode = (r) => {
    const wrap = document.createElement('span');
    wrap.className = 'tok-logo';
    const tile = () => { wrap.replaceChildren(); const t = document.createElement('span'); t.className = 'tok-tile'; t.textContent = (r.symbol.trim()[0] || '?').toUpperCase(); wrap.appendChild(t); };
    if (!r.img) { tile(); return wrap; }
    const img = new Image();
    img.alt = ''; img.width = 36; img.height = 36; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', tile, { once: true });
    img.src = r.img; wrap.appendChild(img);
    return wrap;
  };

  const buildRow = (r) => {
    const li = document.createElement('li');
    li.className = 'mrow spot is-new';
    li.dataset.address = r.address;
    li.innerHTML = '<span class="m-rank"></span><span class="m-tok"><span class="m-logo"></span><span class="m-name"><strong></strong><small></small></span></span><span class="m-cell m-price" data-label="Price"></span><span class="m-cell m-chg" data-label="24h"></span><span class="m-cell m-vol" data-label="Volume"></span><span class="m-cell m-liq" data-label="Liquidity"></span><span class="m-copy"><button type="button" class="icon-btn" data-copy></button></span>';
    li.querySelector('.m-logo').appendChild(logoNode(r));
    const b = li.querySelector('[data-copy]');
    b.innerHTML = COPY_SVG;
    b.addEventListener('click', async () => {
      const ok = await copyText(b.dataset.address);
      b.classList.toggle('is-done', ok);
      const live = document.querySelector('[data-live]'); if (live) live.textContent = ok ? `Address for ${b.dataset.symbol} copied` : 'Copy failed';
      clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('is-done'), 1600);
    });
    return li;
  };

  const render = (rows) => {
    const keep = new Set(rows.map((r) => r.address));
    if (list.querySelector('.is-skeleton')) list.replaceChildren();
    for (const [a, el] of rowsByAddr) if (!keep.has(a)) { el.remove(); rowsByAddr.delete(a); }
    rows.forEach((r, i) => {
      let el = rowsByAddr.get(r.address);
      if (!el) { el = buildRow(r); rowsByAddr.set(r.address, el); }
      el.querySelector('.m-rank').textContent = String(i + 1).padStart(2, '0');
      el.querySelector('strong').textContent = r.symbol;
      el.querySelector('small').textContent = r.name;
      const b = el.querySelector('[data-copy]');
      b.dataset.address = r.address; b.dataset.symbol = r.symbol;
      b.setAttribute('aria-label', `Copy address for ${r.symbol}`);
      countTo(el.querySelector('.m-price'), r.price, fmtPrice);
      const chg = el.querySelector('.m-chg'); countTo(chg, r.change, fmtChange);
      chg.classList.toggle('is-up', r.change >= 0); chg.classList.toggle('is-down', r.change < 0);
      countTo(el.querySelector('.m-vol'), r.volume, fmtMoney);
      countTo(el.querySelector('.m-liq'), r.liquidity, fmtMoney);
      if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
      if (el.classList.contains('is-new')) {
        el.style.transitionDelay = reduced.matches ? '0s' : `${i * 55}ms`;
        requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.remove('is-new'); }));
        setTimeout(() => { el.style.transitionDelay = ''; }, 900 + i * 55);
      }
    });
    if (volEl) countTo(volEl, rows.reduce((s, r) => s + (r.volume || 0), 0), (v) => money.format(v));
    if (cntEl) countTo(cntEl, rows.length, (v) => String(Math.round(v)));
    renderTicker(rows);
  };

  const renderTicker = (rows) => {
    if (!track) return;
    const sig = rows.map((r) => r.address).join();
    if (track.dataset.sig !== sig) {
      track.dataset.sig = sig; track.replaceChildren();
      for (const copy of [false, true]) {
        rows.forEach((r) => {
          const s = document.createElement('span'); s.className = 'tick'; s.dataset.a = r.address;
          if (copy) s.setAttribute('aria-hidden', 'true');
          s.innerHTML = '<b></b><i></i><em></em>';
          track.appendChild(s);
        });
      }
    }
    track.querySelectorAll('.tick').forEach((s) => {
      const r = rows.find((x) => x.address === s.dataset.a); if (!r) return;
      s.querySelector('b').textContent = r.symbol;
      s.querySelector('i').textContent = fmtPrice(r.price);
      const e = s.querySelector('em'); e.textContent = fmtChange(r.change); e.className = r.change >= 0 ? 'is-up' : 'is-down';
    });
  };

  const showError = () => {
    if (lastGood) { setStatus('stale', 'Holding last good data'); setNote('The feed stumbled. The previous good snapshot stays on screen while retries continue.'); return; }
    setStatus('error', 'Feed unreachable');
    setNote('The market feed failed after repeated tries. Another attempt follows on the next cycle.');
    list.replaceChildren(); rowsByAddr.clear();
    const li = document.createElement('li'); li.className = 'mrow is-error';
    li.innerHTML = '<span class="m-err"><strong>—</strong> Error: the market feed did not answer.</span>';
    list.appendChild(li);
    if (volEl) { volEl._v = undefined; volEl.textContent = '—'; }
    if (cntEl) { cntEl._v = undefined; cntEl.textContent = '—'; }
  };

  async function cycle() {
    if (inflight || !base) return;
    inflight = true;
    if (!lastGood) setStatus('loading', 'Syncing');
    let ok = false;
    for (let n = 0; n < MAX_ATTEMPTS && !ok; n++) {
      try {
        const rows = await loadTop(base);
        lastGood = rows; ok = true;
        if (list.querySelector('.is-error')) { list.replaceChildren(); rowsByAddr.clear(); }
        render(rows); setStatus('live', 'Market live'); setNote('');
      } catch {
        if (n < MAX_ATTEMPTS - 1) await sleep(Math.min(20000, 1000 * 2 ** n) + Math.random() * 300);
      }
    }
    if (!ok) showError();
    inflight = false;
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    if (document.hidden) return;
    timer = setTimeout(cycle, POLL_MS);
  }

  if (!base) { setStatus('error', 'Market feed pending'); list.replaceChildren(); return; }
  skeleton();
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (!document.hidden) cycle();
  });
  cycle();
}

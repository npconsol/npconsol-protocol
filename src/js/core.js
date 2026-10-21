// Pure register logic. No DOM access, so gates can run it in Node.
export const STATES = ['stated', 'absent', 'unconfirmed'];

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HEX = /^0x[0-9a-fA-F]{40}$/;

export const addressShape = (s) => (B58.test(s) ? 'solana' : HEX.test(s) ? 'evm' : null);
export const addressPattern = () => /\b(?:0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})\b/g;

export const getRecord = (reg, id) => (reg && Array.isArray(reg.records) ? reg.records.find((r) => r.id === id) || null : null);
export const isStated = (r) => !!r && r.state === 'stated';

export function validateRegister(reg) {
  const problems = [];
  if (!reg || !Array.isArray(reg.records)) return ['register has no records'];
  for (const r of reg.records) {
    if (!STATES.includes(r.state)) problems.push(`${r.id}: bad state`);
    if (r.state !== 'stated' && ('value' in r || 'url' in r)) problems.push(`${r.id}: inert record carries value or url`);
    if (r.state === 'stated' && !('value' in r) && !('url' in r)) problems.push(`${r.id}: stated record has no value or url`);
  }
  return problems;
}

export function handleFromUrl(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return seg ? '@' + seg.replace(/^@/, '') : u.hostname;
  } catch { return null; }
}

const SOCIAL_HOSTS = { x: ['x.com', 'twitter.com'], github: ['github.com'] };

export function socialView(rec, kind) {
  const hosts = SOCIAL_HOSTS[kind] || [];
  if (isStated(rec) && typeof rec.url === 'string') {
    try {
      const u = new URL(rec.url);
      if (u.protocol === 'https:' && hosts.includes(u.hostname.replace(/^www\./, ''))) {
        return { active: true, href: u.href, handle: handleFromUrl(u.href) };
      }
    } catch { /* falls through to inert */ }
  }
  return { active: false, href: null, handle: null };
}

export function caView(rec) {
  if (isStated(rec) && typeof rec.value === 'string' && addressShape(rec.value.trim())) {
    return { active: true, text: rec.value.trim() };
  }
  return { active: false, text: 'pending' };
}

// Address-shaped text is matched to stated registry values. Shape alone never rejects.
export function matchRegistry(str, reg) {
  const shape = addressShape(str);
  if (!shape) return null;
  for (const r of reg.records) {
    if (isStated(r) && typeof r.value === 'string') {
      const same = shape === 'evm' ? r.value.toLowerCase() === str.toLowerCase() : r.value === str;
      if (same) return r;
    }
  }
  return null;
}

export function scanText(text, reg) {
  const out = [];
  for (const m of String(text).matchAll(addressPattern())) {
    out.push({ match: m[0], status: matchRegistry(m[0], reg) ? 'registered' : 'unregistered' });
  }
  return out;
}

export function checkAddress(raw, reg) {
  const s = String(raw || '').trim();
  if (!s) return { kind: 'empty' };
  const shape = addressShape(s);
  if (!shape) return { kind: 'not-address' };
  const hit = matchRegistry(s, reg);
  if (hit) return { kind: 'registered', shape, record: hit.id };
  const ca = getRecord(reg, 'ca');
  return { kind: 'unregistered', shape, caStated: caView(ca).active };
}

export const marketEnabled = (reg) => {
  const r = getRecord(reg, 'market');
  return isStated(r) && typeof r.url === 'string' && r.url.startsWith('https://');
};

export const hostOf = (url) => { try { return new URL(url).hostname; } catch { return null; } };
export const shortAddr = (a) => (a && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || '');

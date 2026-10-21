import { createHash } from 'node:crypto';
const STOP = new Set('a an the and or but nor of in on at to for from by with as into onto over under about after before between through during without within is are was were be been being am do does did has have had it its this that these those there here he she they we you your our their his her my me us them i not no yes can could will would shall should may might must if then than so such what which who whom whose when where why how all any each every both either neither some more most other another own same only very just also too again once up down out off above below s t'.split(' '));
// Word pairs made of two content words that sit next to each other in the text.
export function* bigramHashes(text) {
  const toks = text.toLowerCase().replace(/<[^>]*>/g, ' | ').replace(/\$\{[^}]*\}/g, ' ').match(/[a-z0-9$']+|[.,;:!?()|\n]/g) || [];
  let prev = null;
  for (const t of toks) {
    const w = t.replace(/^\$/, '');
    if (!/^[a-z']+$/.test(w) || STOP.has(w) || w.length < 2) { prev = null; continue; }
    if (prev) yield [`${prev} ${w}`, createHash('sha1').update(`${prev} ${w}`).digest('hex').slice(0, 10)];
    prev = w;
  }
}
// Human-readable string literals from a JS file (class lists, selectors and markup skipped).
export function copyStrings(js) {
  const re = /'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  return [...js.matchAll(re)].map((m) => m[1] || m[2] || '')
    .filter((s) => / /.test(s) && !/[<>=#\[\]{}/]/.test(s) && !/^[a-z0-9 _-]+$/.test(s)).join('\n');
}

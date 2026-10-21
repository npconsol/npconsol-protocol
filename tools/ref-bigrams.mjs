// Usage: node tools/ref-bigrams.mjs <dir with fetched reference files>
// Stores only hashed word pairs, not reference text.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { bigramHashes } from './bigrams.mjs';
const dir = process.argv[2];
const set = new Set();
for (const f of readdirSync(dir)) {
  if (/embed\.js$/.test(f)) continue;
  for (const [, h] of bigramHashes(readFileSync(`${dir}/${f}`, 'utf8'))) set.add(h);
}
writeFileSync(new URL('./ref-bigrams.json', import.meta.url), JSON.stringify([...set]));
console.log('bigrams', set.size);

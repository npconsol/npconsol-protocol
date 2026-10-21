# NPC

Step out of the script.

[![Live site](https://img.shields.io/badge/site-npconsol.fun-f45a17)](https://npconsol.fun)
[![Chain](https://img.shields.io/badge/chain-Solana-4f4f4e)](https://solana.com)

**Chain:** Solana
**Contract address:** pending (not yet stated)

## Overview

NPC is a Solana project site. It shows a live tape of the busiest Solana tokens,
keeps a register of every outside fact with an explicit state, and offers a small
console that compares any pasted address against that register.

## Features

- Live top-ten Solana volume table with logos, price, 24h change, volume, liquidity and per-row copy buttons
- Price strip driven by the same data, polled every minute and paused while the tab is hidden
- Register of records (stated, absent, unconfirmed); waiting records render inert with no value and no link
- Address console that matches strings to stated records without banning 0x-style input outright
- Contract slot pinned at the top of the page, click to copy once an address is stated
- Rich motion, with a calm fallback for anyone who asks for less

## Links

- Site: https://npconsol.fun
- X: pending
- GitHub: pending

## Development

```
npm run build   # writes dist/
npm run gates   # runs the checks against dist/
npm run serve   # serves dist/ on http://localhost:4173
```

`dist/` is the folder to upload. Records live in `src/register.json`; flipping one to `stated`
and adding its `value` or `url` is all it takes to switch its slot on.

## License

MIT

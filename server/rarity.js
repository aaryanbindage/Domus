// Sigil rarities and face values. A Sigil's rarity is fixed by its serial number; the
// SigilLedger contract computes the same function on-chain (see chain.rarityThresholds).
import crypto from 'node:crypto';
import { NATION } from './config.js';

const VALUES = NATION.currency.values;
export const RARITIES = [
  { id: 'legendary', rank: 5, odds: 0.002 },
  { id: 'epic', rank: 4, odds: 0.01 },
  { id: 'rare', rank: 3, odds: 0.048 },
  { id: 'uncommon', rank: 2, odds: 0.16 },
  { id: 'common', rank: 1, odds: 1 },
].map((r) => ({ ...r, value: VALUES[r.id] }));
export const RANK = Object.fromEntries(RARITIES.map((r) => [r.id, r]));
export const valueOf = (rarity) => VALUES[rarity];

export function rarityFor(serial) {
  const r = crypto.createHash('sha256').update(`sigil:${serial}`).digest().readUInt32BE(0) / 2 ** 32;
  let acc = 0;
  for (const t of RARITIES) { acc += t.odds; if (r < acc) return t; }
  return RARITIES.at(-1);
}

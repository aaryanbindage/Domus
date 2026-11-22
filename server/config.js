import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');       // public listing images
export const PRIVATE_DIR = path.join(DATA_DIR, 'private');      // identity documents — never served statically
export const PORT = Number(process.env.PORT || 3000);
export const DEV = process.env.NODE_ENV !== 'production';
export const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

export const NATION = {
  name: process.env.NATION_NAME || 'Republic of Veridia',
  short: process.env.NATION_SHORT || 'Veridia',
  demonym: process.env.NATION_DEMONYM || 'Veridian',
  code: process.env.NATION_CODE || 'VRD',          // ISO-style 3-letter code used in passports / MRZ
  motto: process.env.NATION_MOTTO || 'Veritas in Unitate',
  founded: '2026-11-21',
  currency: {
    name: 'Sigil', plural: 'Sigils', symbol: 'SGL',
    // Face value of one Sigil of each rarity, in SGL. Fixed by the Sigil Currency Act.
    values: { common: 1, uncommon: 2, rare: 5, epic: 25, legendary: 100 },
  },
  citizenshipGrant: 1000,
};

export const SECURITY = {
  epochSeconds: 300,              // the rotating server key changes every 5 minutes
  passportElevationSeconds: 900,  // a passport-image check unlocks standard secure actions for 15 minutes
  sessionDays: 14,
  pbkdf2Iterations: 600000,       // used client-side to encrypt the .access file
  billSignatureThreshold: Number(process.env.BILL_SIGNATURES || 3),
  billVotingDays: Number(process.env.BILL_VOTING_DAYS || 7),
};

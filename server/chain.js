// The on-chain side of the Sigil. Every grant, payment, Mint exchange and escrow movement is
// a transaction on an EVM chain running contracts/SigilLedger.sol. The Treasury key below is
// the contract's registrar: it registers citizens and relays their signed payments (paying
// the gas), so citizens need no wallet software and no ETH. Their own signing key is derived
// from the private key inside their .access file.
//
//   CHAIN_RPC unset → an embedded local chain stored in data/chain (development and tests)
//   CHAIN_RPC=https://sepolia.base.org CHAIN_PRIVATE_KEY=0x… → a public test network; the
//   key's address needs a little test ETH from a faucet to pay gas.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { AbiCoder, BrowserProvider, Contract, ContractFactory, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes, verifyMessage, verifyTypedData, ZeroHash } from 'ethers';
import { DATA_DIR, NATION, ROOT } from './config.js';
import { RARITIES } from './rarity.js';

const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts', 'SigilLedger.json'), 'utf8'));
const STATE_FILE = path.join(DATA_DIR, 'chain.json');
export const TREASURY_ID = 0xFFFFFFFF;
export const ESCROW_ID = 0xFFFFFFFE;
const RARITY_INDEX = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

let provider; let registrar; let contract; let info; let ready;

/** Thresholds equivalent to rarityFor(): x/2^32 < acc  ⇔  x < ceil(acc·2^32). */
export function rarityThresholds() {
  let acc = 0;
  return RARITIES.slice(0, 4).map((r) => { acc += r.odds; return BigInt(Math.ceil(acc * 2 ** 32)); });
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), { mode: 0o600 }); }

async function embeddedProvider(state) {
  // ganache warns once that its optional native websocket module is missing; it is not used here.
  const warn = console.warn; const log = console.log; const err = console.error;
  console.warn = console.log = console.error = () => {};
  const require = createRequire(import.meta.url);
  let ganache;
  try { ganache = require('ganache'); } finally { console.warn = warn; console.log = log; console.error = err; }
  fs.mkdirSync(path.join(DATA_DIR, 'chain'), { recursive: true });
  const eip1193 = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 1337, hardfork: 'shanghai' },
    database: { dbPath: path.join(DATA_DIR, 'chain') },
    miner: { instamine: 'eager', blockGasLimit: 60_000_000 },
    wallet: { accounts: [{ secretKey: state.registrarKey, balance: '0x' + (10n ** 24n).toString(16) }] },
  });
  return { provider: new BrowserProvider(eip1193, 1337), eip1193 };
}

let eip1193 = null;
export function init() {
  ready ||= (async () => {
    const state = loadState();
    const rpc = process.env.CHAIN_RPC || '';
    if (rpc) {
      provider = new JsonRpcProvider(rpc);
      registrar = new Wallet(process.env.CHAIN_PRIVATE_KEY || state.registrarKey || (state.registrarKey = Wallet.createRandom().privateKey), provider);
    } else {
      state.registrarKey ||= Wallet.createRandom().privateKey;
      ({ provider, eip1193 } = await embeddedProvider(state));
      registrar = new Wallet(state.registrarKey, provider);
    }
    const { chainId } = await provider.getNetwork();
    const key = String(chainId);
    state.contracts ||= {};
    let address = state.contracts[key];
    if (!address || (await provider.getCode(address)) === '0x') {
      const bal = await provider.getBalance(registrar.address);
      if (bal === 0n) {
        saveState(state);
        throw new Error(`The Treasury chain key ${registrar.address} has no gas on chain ${chainId}. Fund it from a faucet, then restart.`);
      }
      const factory = new ContractFactory(artifact.abi, artifact.bytecode, registrar);
      const values = RARITY_INDEX.map((r) => BigInt(NATION.currency.values[r]));
      const c = await factory.deploy(`${NATION.name} ${NATION.currency.name}`, NATION.citizenshipGrant, rarityThresholds(), values);
      await c.waitForDeployment();
      address = await c.getAddress();
      state.contracts[key] = address;
      console.log(`[chain] SigilLedger deployed at ${address} on chain ${chainId}`);
    }
    saveState(state);
    contract = new Contract(address, artifact.abi, registrar);
    info = {
      chainId: Number(chainId), contract: address, registrar: registrar.address,
      network: rpc ? (process.env.CHAIN_NAME || new URL(rpc).host) : 'Embedded local chain',
      explorer: process.env.CHAIN_EXPLORER || null, embedded: !rpc,
      domain: { name: `${NATION.name} ${NATION.currency.name}`, version: '1', chainId: Number(chainId), verifyingContract: address },
    };
    return info;
  })();
  return ready;
}

export const chainInfo = () => info;
export const toChainId = (dbId) => (dbId === 0 ? TREASURY_ID : dbId);
export const fromChainId = (id) => (Number(id) === TREASURY_ID ? 0 : Number(id));

export const TYPES = {
  Transfer: [
    { name: 'from', type: 'uint32' }, { name: 'to', type: 'uint32' }, { name: 'amount', type: 'uint256' },
    { name: 'serialsHash', type: 'bytes32' }, { name: 'ref', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  ],
  Exchange: [{ name: 'from', type: 'uint32' }, { name: 'serial', type: 'uint32' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }],
};
export const serialsHash = (serials) => (serials?.length ? keccak256(AbiCoder.defaultAbiCoder().encode(['uint32[]'], [serials])) : ZeroHash);
export const refOf = (text) => keccak256(toUtf8Bytes(text));

/** The message a citizen proves control of their chain key with, when it is linked to their account. */
export const linkMessage = (username, keyId) => `${NATION.name}: link my Domus wallet to @${username}, key ${keyId}`;
export const verifyLink = (username, keyId, address, sig) => {
  try { return verifyMessage(linkMessage(username, keyId), sig).toLowerCase() === String(address).toLowerCase(); } catch { return false; }
};
export function verifyIntent(primaryType, message, sig, signer) {
  try { return verifyTypedData(info.domain, { [primaryType]: TYPES[primaryType] }, message, sig).toLowerCase() === signer.toLowerCase(); } catch { return false; }
}

// Registrar transactions are sent strictly one at a time so nonces never collide.
let queue = Promise.resolve();
function send(label, fn) {
  const run = async () => {
    try {
      const txr = await fn();
      const receipt = await txr.wait();
      return { hash: receipt.hash, receipt };
    } catch (e) {
      const name = e.revert?.name || e.info?.error?.data?.reason || null;
      throw Object.assign(new Error(`On-chain ${label} was rejected${name ? ` (${name})` : ''}: ${FRIENDLY[name] || e.shortMessage || e.message}`), { status: 400 });
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}
const FRIENDLY = {
  NotCitizen: 'both parties must be active citizens', BadSignature: 'the Sigil wallet signature is not valid',
  BadNonce: 'this payment was already used or is out of order — try again', Expired: 'the signed payment expired — try again',
  NotOwner: 'a Sigil is not owned by the payer', ValueMismatch: 'the Sigils are not worth exactly the amount', NotAllowed: 'not permitted by the Sigil contract',
};

const events = (receipt, name) => receipt.logs.map((l) => { try { return contract.interface.parseLog(l); } catch { return null; } }).filter((e) => e?.name === name);

export async function registerCitizen(id, address) {
  const c = await contract.citizens(id);
  if (c.signer === '0x0000000000000000000000000000000000000000') return send('registration', () => contract.register(id, address));
  if (c.signer.toLowerCase() !== address.toLowerCase()) return send('key change', () => contract.setSigner(id, address));
  return null;
}
export const setActive = (id, active) => send(active ? 'reinstatement' : 'suspension', () => contract.setActive(id, active));

export async function grant(id) {
  const { hash, receipt } = await send('citizenship grant', () => contract.grant(id));
  const e = events(receipt, 'Minted')[0];
  return { hash, first: Number(e.args.firstSerial), count: Number(e.args.count), value: Number(e.args.value) };
}

export async function transfer(message, sig, serials, breaks) {
  const { hash, receipt } = await send('payment', () => contract.transfer(message, sig, serials, breaks));
  return { hash, minted: events(receipt, 'Minted').map((e) => ({ first: Number(e.args.firstSerial), count: Number(e.args.count) })) };
}
export async function exchange(message, sig, change, mintCommons) {
  const { hash, receipt } = await send('Mint exchange', () => contract.exchange(message, sig, change, mintCommons));
  return { hash, minted: events(receipt, 'Minted').map((e) => ({ first: Number(e.args.firstSerial), count: Number(e.args.count) })) };
}
export const releaseEscrow = (to, serials, ref) => send('escrow release', () => contract.releaseEscrow(to, serials, ref));

export const nonceOf = async (id) => Number(await contract.nonces(id));
export const nextSerial = async () => Number(await contract.nextSerial());
export const citizenOf = async (id) => { const c = await contract.citizens(id); return { signer: c.signer, active: c.active, granted: c.granted }; };
export const chainBalance = async (id) => ({ value: Number(await contract.balanceOf(toChainId(id))), count: Number(await contract.countOf(toChainId(id))) });

/** Owners of serials [first, first+count) as stored on chain (db ids; escrow as 'escrow'). */
export async function ownersOf(first, count) {
  const out = [];
  for (let s = first; s < first + count; s += 2000) {
    const n = Math.min(2000, first + count - s);
    for (const o of await contract.ownersOf(s, n)) out.push(Number(o) === ESCROW_ID ? 'escrow' : fromChainId(o));
  }
  return out;
}
export const raritiesOf = async (serials) => Promise.all(serials.map(async (s) => RARITY_INDEX[Number(await contract.rarityOf(s))]));

/** Read-only JSON-RPC for public auditing of the embedded chain with any Ethereum tool. */
export const READ_METHODS = new Set(['eth_chainId', 'net_version', 'eth_blockNumber', 'eth_call', 'eth_getLogs', 'eth_getCode', 'eth_getBalance',
  'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getTransactionCount', 'eth_getStorageAt']);
export async function rpc(method, params) {
  if (!READ_METHODS.has(method)) throw Object.assign(new Error('Only read-only methods are available'), { status: 400 });
  return eip1193 ? eip1193.request({ method, params }) : provider.send(method, params);
}

export async function close() {
  if (eip1193) await eip1193.disconnect().catch(() => {});
}

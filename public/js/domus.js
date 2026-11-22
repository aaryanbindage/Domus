// Domus — the nation's built-in Sigil wallet. There is nothing to install: the wallet's
// signing key is derived in this browser from the private key inside the citizen's .access
// file, so the .access file *is* the wallet. Payments are signed here (EIP-712) and relayed
// on-chain by the Treasury, which pays the gas; the citizen never needs ETH.
import { Wallet, keccak256, concat, toUtf8Bytes, decodeBase64 } from '/vendor/ethers.js';

const DERIVATION = 'DOMUS-WALLET/1';

/** The same .access key always gives the same Domus wallet. */
export function domusWallet(pkcs8B64) {
  return new Wallet(keccak256(concat([toUtf8Bytes(DERIVATION), decodeBase64(pkcs8B64)])));
}

/** Proves to the Treasury that this browser holds the wallet key for this passport key. */
export const linkMessage = (nationName, username, keyId) => `${nationName}: link my Domus wallet to @${username}, key ${keyId}`;
export const linkProof = (wallet, nationName, username, keyId) => wallet.signMessage(linkMessage(nationName, username, keyId));

/** Sign the exact payment the server will relay; the contract checks this signature again. */
export const signIntent = (wallet, it) => wallet.signTypedData(it.domain, it.types, it.message);

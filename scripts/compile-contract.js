// Compiles contracts/SigilLedger.sol into contracts/SigilLedger.json (ABI + bytecode).
// The JSON is committed, so running the nation does not need the compiler.
import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';

const dir = path.resolve(import.meta.dirname, '../contracts');
const source = fs.readFileSync(path.join(dir, 'SigilLedger.sol'), 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'SigilLedger.sol': { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors || []).filter((e) => e.severity === 'error');
for (const e of out.errors || []) console.error(e.formattedMessage);
if (errors.length) process.exit(1);
const c = out.contracts['SigilLedger.sol'].SigilLedger;
fs.writeFileSync(path.join(dir, 'SigilLedger.json'), JSON.stringify({ compiler: solc.version(), abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }, null, 1) + '\n');
console.log(`Compiled SigilLedger (${c.evm.bytecode.object.length / 2} bytes) with solc ${solc.version()}`);

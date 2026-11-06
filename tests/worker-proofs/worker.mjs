import * as RT from '@midnight-ntwrk/compact-runtime';
import { provingProvider } from '../../node_modules/@midnight-ntwrk/zkir-v2/midnight_zkir_wasm.js';
import * as zkirWasm from '../../node_modules/@midnight-ntwrk/zkir-v2/midnight_zkir_wasm_bg.wasm';
import { createNativeHarness, randomHex32, bytes, taxpayerDigestFor } from '../../lib/native-engine.mjs';

const names = ['mint', 'donate'];
const cache = new Map();
async function asset(path) {
  if (!cache.has(path)) cache.set(path, fetch(new URL(`./assets/${path}`, import.meta.url), { credentials: 'omit', redirect: 'error' }).then(async response => {
    if (!response.ok) throw new Error('Public proving asset unavailable');
    return new Uint8Array(await response.arrayBuffer());
  }));
  return cache.get(path);
}
const keys = {
  async lookupKey(name) {
    if (!names.includes(name)) return undefined;
    const [ir, proverKey, verifierKey] = await Promise.all([
      asset(`contract/zkir/${name}.bzkir`), asset(`contract/keys/${name}.prover`), asset(`contract/keys/${name}.verifier`),
    ]);
    return { ir, proverKey, verifierKey };
  },
  async getParams(k) {
    if (![13, 14, 15, 16, 17].includes(k)) throw new Error('Unexpected parameter size');
    return asset(`params/bls_midnight_2p${k}`);
  },
};
let started = false;
addEventListener('message', async ({ data }) => {
  if (started || data?.op !== 'prove-synthetic') return;
  started = true;
  const calls = [];
  let stage = 'generated-contract-fixture';
  try {
    const now = Math.floor(Date.now() / 1000);
    const native = await createNativeHarness({ now, onCircuit({ name, result }) {
      const { input, output, publicTranscript, privateTranscriptOutputs } = result.proofData;
      calls.push({ name, preimage: RT.proofDataIntoSerializedPreimage(input, output, publicTranscript, privateTranscriptOutputs, name) });
    } });
    native.call('mint', [{ bytes: bytes(native.coinPublicKey) }, 1000n, bytes(randomHex32())]);
    const coin = { nonce: bytes(randomHex32()), color: native.pure.testTokenColor(bytes(native.contractAddress)), value: 125n };
    const receiptId = bytes(randomHex32());
    const inputs = { donorSecret: bytes(randomHex32()), taxpayerDigest: bytes(await taxpayerDigestFor('SYNTHETIC-WORKER-DONOR')), receiptSalt: bytes(randomHex32()) };
    const args = [coin, receiptId, BigInt(now), BigInt(now + 1200)];
    native.call('donate', args, inputs);
    let duplicateRejected = false;
    try { native.call('donate', args, inputs); } catch { duplicateRejected = true; }
    if (!duplicateRejected) throw new Error('Duplicate donation was accepted');
    let wrongAssetRejected = false;
    try { native.call('donate', [{ ...coin, color: bytes(randomHex32()) }, bytes(randomHex32()), BigInt(now), BigInt(now + 1200)], inputs); } catch { wrongAssetRejected = true; }
    if (!wrongAssetRejected) throw new Error('Wrong token accepted');
    if (calls.length !== names.length || calls.some((call, index) => call.name !== names[index])) throw new Error('Unexpected generated circuit sequence');
    const provider = provingProvider(keys), proofs = [];
    stage = 'wrong-circuit-key-check';
    let wrongCircuitRejected = false;
    const wrongKeys = provingProvider({ lookupKey: () => keys.lookupKey('mint'), getParams: keys.getParams });
    try { await wrongKeys.check(calls[1].preimage, 'donate'); } catch { wrongCircuitRejected = true; }
    if (!wrongCircuitRejected) throw new Error('Wrong circuit accepted a donation preimage');
    for (const call of calls) {
      stage = call.name; postMessage({ type: 'progress', circuit: call.name });
      const began = performance.now();
      await provider.check(call.preimage, call.name);
      const proof = await provider.prove(call.preimage, call.name);
      if (!(proof instanceof Uint8Array) || proof.length === 0 || !proof.some(value => value !== 0)) throw new Error('Empty proof');
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', proof)), value => value.toString(16).padStart(2, '0')).join('');
      proofs.push({ circuit: call.name, rawProofBytes: proof.length, sha256, elapsedMs: Math.round(performance.now() - began), zkirMemoryBytes: zkirWasm.memory.buffer.byteLength });
      call.preimage.fill(0); proof.fill(0); postMessage({ type: 'proof-completed', circuit: call.name });
    }
    postMessage({ type: 'complete', proofs,
      negativeChecks: { duplicateDonationRejectedBeforeProving: duplicateRejected, wrongAssetRejectedBeforeProving: wrongAssetRejected, wrongCircuitPreimageRejectedByZkirCheck: wrongCircuitRejected },
      sharedWasmMemory: typeof SharedArrayBuffer === 'function' && zkirWasm.memory.buffer instanceof SharedArrayBuffer,
      crossOriginIsolated: self.crossOriginIsolated, privateInputsGeneratedInsideWorker: true,
    });
  } catch { postMessage({ type: 'failed', category: 'worker-proof-check-failed', stage }); }
  finally { for (const call of calls) call.preimage.fill(0); }
});
postMessage({ type: 'ready' });

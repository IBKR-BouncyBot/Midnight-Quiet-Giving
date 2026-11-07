import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { Effect } from 'effect';
import { WasmProver } from '@midnightntwrk/wallet-sdk/prover-client/effect';
import { CostModel, Transaction } from '@midnight-ntwrk/midnight-js-protocol/v9';
import { createProofProviderFromProvingProviders } from '@midnight-ntwrk/midnight-js-types';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { AcceptanceFailure, bounded, requireCondition, requireRemoteRunner } from './runtime.mjs';

const nativeNames = new Set(['midnight/zswap/spend', 'midnight/zswap/output', 'midnight/zswap/sign', 'midnight/dust/spend']);
export async function createRunnerProving({ compiledAssetsPath, manifestHash, metrics }) {
  requireRemoteRunner();
  metrics.contractProofs = []; metrics.walletProofs = []; metrics.checks = 0; metrics.nativeKeyMaterial = [];
  const nativeMaterial = WasmProver.makeV9KeyMaterialProvider();
  const recorded = new Set();
  const nativeKeys = {
    async lookupKey(key) {
      requireCondition(nativeNames.has(key), 'UNEXPECTED_WALLET_PROVING_KEY');
      const material = await nativeMaterial.lookupKey(key);
      requireCondition(material, 'MISSING_WALLET_PROVING_KEY');
      if (!recorded.has(key)) {
        recorded.add(key);
        metrics.nativeKeyMaterial.push({ key, generation: 10, sha256: Object.fromEntries(
          ['ir', 'proverKey', 'verifierKey'].map(name => [name, createHash('sha256').update(material[name]).digest('hex')])) });
      }
      return material;
    },
    getParams: k => nativeMaterial.getParams(k),
  };
  const walletProver = (await Effect.runPromise(WasmProver.create({ keyMaterialProvider: nativeKeys }))).asProvingProvider();
  const instrumentedWallet = {
    ...nativeKeys,
    async check(preimage, key) { requireCondition(nativeNames.has(key), 'UNEXPECTED_WALLET_PROVING_KEY'); const result = await walletProver.check(preimage, key); metrics.checks++; return result; },
    async prove(preimage, key, binding) {
      requireCondition(nativeNames.has(key), 'UNEXPECTED_WALLET_PROVING_KEY');
      const started = performance.now(), result = await walletProver.prove(preimage, key, binding);
      requireCondition(result instanceof Uint8Array && result.length > 0, 'EMPTY_WALLET_PROOF');
      metrics.walletProofs.push({ circuit: key, bytes: result.length, elapsedMs: Math.round(performance.now() - started) });
      return result;
    },
  };
  const worker = new Worker(new URL('./contract-proof-worker.mjs', import.meta.url), { workerData: { compiledAssetsPath, manifestHash } });
  const pending = new Map(); let sequence = 0, failed = false;
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  function failAll() { failed = true; readyReject(new AcceptanceFailure('CONTRACT_PROVER_WORKER_FAILED')); for (const request of pending.values()) request.reject(new AcceptanceFailure('CONTRACT_PROVER_WORKER_FAILED')); pending.clear(); }
  worker.on('error', failAll);
  worker.on('exit', code => { if (code !== 0) failAll(); });
  worker.on('message', message => {
    if (message.ready === true) { readyResolve(); return; }
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id);
    if (!message.ok) request.reject(new AcceptanceFailure('CONTRACT_PROOF_FAILED'));
    else request.resolve(message);
  });
  await bounded(ready, 60_000, 'CONTRACT_PROVER_START_TIMEOUT');
  async function operation(name, preimage, key, binding) {
    requireCondition(!failed && ['mint', 'donate'].includes(key), 'CONTRACT_PROVER_UNAVAILABLE');
    const id = ++sequence, started = performance.now();
    const response = new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); });
    worker.postMessage({ id, operation: name, preimage, key, binding });
    let result;
    try { result = await bounded(response, 10 * 60_000, 'CONTRACT_PROOF_TIMEOUT'); }
    catch (error) { pending.delete(id); await worker.terminate(); throw error; }
    if (name === 'prove') {
      requireCondition(result.value instanceof Uint8Array && result.value.length > 0, 'EMPTY_CONTRACT_PROOF');
      metrics.contractProofs.push({ circuit: key, bytes: result.value.length, sha256: result.sha256, elapsedMs: Math.round(performance.now() - started) });
    } else metrics.checks++;
    return result.value;
  }
  // Midnight.js constructs shielded outputs before wallet balancing, so an
  // application transaction can contain both contract and native Zswap proofs.
  const contractKeys = new NodeZkConfigProvider(compiledAssetsPath, { verify: 'require', expectedManifestHash: manifestHash });
  const applicationProver = {
    async lookupKey(key) {
      if (nativeNames.has(key)) return nativeKeys.lookupKey(key);
      requireCondition(['mint', 'donate'].includes(key), 'UNEXPECTED_CONTRACT_PROVING_KEY');
      const material = await contractKeys.get(key);
      return { ir: material.zkir, proverKey: material.proverKey, verifierKey: material.verifierKey };
    },
    check: (preimage, key) => nativeNames.has(key) ? instrumentedWallet.check(preimage, key) : operation('check', preimage, key),
    prove: (preimage, key, binding) => nativeNames.has(key) ? instrumentedWallet.prove(preimage, key, binding) : operation('prove', preimage, key, binding),
  };
  return {
    proofProvider: createProofProviderFromProvingProviders({ v8: undefined, v9: applicationProver }),
    walletProvingService: { async prove(transaction, protocolVersion) {
      requireCondition(protocolVersion >= 2_000_000 && transaction instanceof Transaction, 'LEDGER9_WALLET_PROOF_REQUIRED');
      return transaction.prove(instrumentedWallet, CostModel.initialCostModel());
    } },
    nativeKeys,
    async close() { await worker.terminate(); },
  };
}

// Official zkIR 3 executes only inside this remote runner's worker thread.
// Private preimages and raw proofs are never written to files or log output.
import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { requireRemoteRunner } from './runtime.mjs';
requireRemoteRunner();
for (const name of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir']) console[name] = () => {};
const [{ provingProvider }, { NodeZkConfigProvider }, { WasmProver }] = await Promise.all([
  import('@midnight-ntwrk/zkir-v3'), import('@midnight-ntwrk/midnight-js-node-zk-config-provider'),
  import('@midnightntwrk/wallet-sdk/prover-client/effect'),
]);
const config = new NodeZkConfigProvider(workerData.compiledAssetsPath, { verify: 'require', expectedManifestHash: workerData.manifestHash });
const publicParameters = WasmProver.makeV9KeyMaterialProvider();
const allowed = new Set(['mint', 'donate']);
const provider = provingProvider({
  async lookupKey(name) {
    if (!allowed.has(name)) throw new Error('Unexpected contract circuit');
    const value = await config.get(name);
    return { ir: value.zkir, proverKey: value.proverKey, verifierKey: value.verifierKey };
  },
  getParams: k => publicParameters.getParams(k),
});
let tail = Promise.resolve();
parentPort.on('message', message => {
  tail = tail.then(async () => {
    if (!['check', 'prove'].includes(message.operation) || !allowed.has(message.key) || !(message.preimage instanceof Uint8Array)) throw new Error('Invalid proof operation');
    try {
      const value = message.operation === 'check' ? await provider.check(message.preimage, message.key)
        : await provider.prove(message.preimage, message.key, message.binding);
      const digest = value instanceof Uint8Array ? createHash('sha256').update(value).digest('hex') : undefined;
      parentPort.postMessage({ id: message.id, ok: true, value, ...(digest ? { sha256: digest } : {}) });
      if (value instanceof Uint8Array) value.fill(0);
    } catch { parentPort.postMessage({ id: message.id, ok: false }); }
    finally { message.preimage.fill(0); }
  }).catch(() => { parentPort.postMessage({ id: message.id, ok: false }); });
});
parentPort.postMessage({ ready: true });

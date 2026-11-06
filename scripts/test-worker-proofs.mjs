/** Real browser-worker proof generation with synthetic inputs only.
 * Prerequisites: npm ci; npm run compile.
 * This builds an isolated test bundle, never the application dist directory.
 * First run downloads hash-pinned public parameters. --offline requires cache.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as pause } from 'node:timers/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { nativeWasmPlugin } from './native-wasm-plugin.mjs';
import { createStaticServer } from './serve.mjs';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'package.json'));
const fixture = join(root, 'tests/worker-proofs');
const artifacts = join(root, 'artifacts/worker-proofs');
const directory = join(artifacts, 'bundle');
const names = ['mint', 'donate'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const output = value => process.stdout.write(JSON.stringify(value) + '\n');
const report = {
  schema: 'donations-browser-worker-proofs/v1', startedAt: new Date().toISOString(), status: 'running',
  networkSubmission: false, networkAcceptance: false, walletConnected: false, realLaceWalletTested: false,
  walletDustProofsTested: false, proofServerUsed: false, independentProofVerification: false,
  privateInputsSynthetic: true, privateInputsGeneratedInsideWorker: false, proofs: [], assets: [], sourceHashes: {},
};
let browser, context, server, stage = 'prerequisites';
async function recordAsset(path, bytes) {
  const name = relative(directory, path).replaceAll('\\', '/');
  assert(!name.startsWith('../'));
  report.assets.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
}
async function parameters(manifest, offline) {
  assert.equal(manifest.baseUrl, 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com/');
  assert.deepEqual(manifest.parameters.map(item => item.name), ['bls_midnight_2p13', 'bls_midnight_2p14', 'bls_midnight_2p15', 'bls_midnight_2p16', 'bls_midnight_2p17']);
  for (const item of manifest.parameters) {
    const path = join(directory, 'assets/params', item.name);
    await mkdir(dirname(path), { recursive: true });
    let bytes = await readFile(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!bytes) {
      assert(!offline, 'Public parameters are not cached');
      const url = new URL(item.name, manifest.baseUrl);
      const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(60000) });
      assert(response.ok && !response.redirected && response.url === url.href);
      const chunks = []; let length = 0;
      for await (const chunk of response.body) { length += chunk.length; assert(length <= item.bytes); chunks.push(chunk); }
      bytes = Buffer.concat(chunks, length);
      assert.equal(bytes.length, item.bytes); assert.equal(sha256(bytes), item.sha256);
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, path);
      report.publicParameterDownloads = (report.publicParameterDownloads ?? 0) + 1;
    }
    assert.equal(bytes.length, item.bytes); assert.equal(sha256(bytes), item.sha256);
    await recordAsset(path, bytes);
  }
}

try {
  assert(process.argv.slice(2).every((value, index) => index === 0 && value === '--offline'));
  await mkdir(directory, { recursive: true });
  const zkirPackage = JSON.parse(await readFile(join(root, 'node_modules/@midnight-ntwrk/zkir-v2/package.json'), 'utf8'));
  const runtimePackage = JSON.parse(await readFile(join(root, 'node_modules/@midnight-ntwrk/compact-runtime/package.json'), 'utf8'));
  assert.equal(zkirPackage.version, '2.1.1'); assert.equal(runtimePackage.version, '0.16.0');
  report.versions = { zkir: zkirPackage.version, compactRuntime: runtimePackage.version, compilerTarget: '0.31.1' };
  const sources = ['scripts/test-worker-proofs.mjs', 'scripts/native-wasm-plugin.mjs', 'scripts/serve.mjs',
    'tests/worker-proofs/worker.mjs', 'tests/worker-proofs/page.mjs', 'tests/worker-proofs/index.html',
    'tests/worker-proofs/public-assets.json', 'lib/native-engine.mjs', 'contracts/donations.compact',
    'contracts/managed/donations/contract/index.js', 'package-lock.json'];
  for (const path of sources) report.sourceHashes[path] = sha256(await readFile(join(root, path)));
  stage = 'public-parameters';
  await parameters(JSON.parse(await readFile(join(fixture, 'public-assets.json'), 'utf8')), process.argv.includes('--offline'));
  stage = 'compiled-contract-assets';
  for (const name of names) for (const [folder, extension] of [['keys', 'prover'], ['keys', 'verifier'], ['zkir', 'bzkir']]) {
    const source = join(root, 'contracts/managed/donations', folder, `${name}.${extension}`);
    const path = join(directory, 'assets/contract', folder, `${name}.${extension}`);
    const bytes = await readFile(source); assert(bytes.length > 0);
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); await recordAsset(path, bytes);
  }
  stage = 'worker-bundle';
  const wasm = new Map();
  const result = await build({ absWorkingDir: root, entryPoints: [join(fixture, 'worker.mjs')],
    outfile: join(directory, 'proof-worker.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    conditions: ['browser', 'import'], mainFields: ['browser', 'module', 'main'], metafile: true, logLevel: 'silent',
    inject: [join(root, 'scripts/network-browser-globals.mjs')],
    plugins: [nativeWasmPlugin(wasm, { projectRoot: root, assetFolder: 'wasm', browserPackages: {
      // The generated contract and preimage serializer must share this runtime.
      '@midnight-ntwrk/compact-runtime': join(root, 'node_modules/@midnight-ntwrk/compact-runtime/dist/index.js'),
      buffer: require.resolve('buffer/'),
    } })],
  });
  assert.equal(result.warnings.length, 0);
  assert(Object.keys(result.metafile.inputs).some(path => path.includes('zkir-v2/midnight_zkir_wasm.js')));
  assert(Object.keys(result.metafile.inputs).some(path => path.endsWith('managed/donations/contract/index.js')));
  assert(!Object.values(result.metafile.outputs).flatMap(value => value.imports).some(item => item.external));
  assert(wasm.size >= 2);
  for (const [name, bytes] of wasm) {
    const path = join(directory, name); await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes); await recordAsset(path, bytes);
  }
  for (const name of ['page.mjs', 'index.html']) await copyFile(join(fixture, name), join(directory, name));
  for (const name of ['proof-worker.mjs', 'page.mjs', 'index.html']) await recordAsset(join(directory, name), await readFile(join(directory, name)));

  stage = 'browser-worker-proofs';
  server = createStaticServer({ directory, port: 0 }); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1000, height: 650 } });
  let rejectedRequests = 0, pageErrors = 0;
  const fetchedPaths = new Set();
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin || request.method() !== 'GET') { rejectedRequests++; return route.abort('blockedbyclient'); }
    return route.continue();
  });
  context.on('response', response => { if (response.ok() && new URL(response.url()).origin === origin) fetchedPaths.add(new URL(response.url()).pathname.slice(1)); });
  const page = await context.newPage(); page.on('pageerror', () => pageErrors++);
  await page.goto(`${origin}/`);
  let observed = 0, final = null;
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => ({ events: window.workerProofTest?.events ?? [], result: window.workerProofTest?.result ?? null }));
    for (const event of state.events.slice(observed)) if (event.type === 'progress') output({ stage: 'worker-proof', circuit: event.circuit });
    observed = state.events.length;
    if (state.result) { final = state.result; report.events = state.events; break; }
    await pause(1000);
  }
  report.rejectedBrowserRequests = rejectedRequests; report.pageErrors = pageErrors;
  if (final?.type === 'failed') report.workerFailure = { category: final.category, stage: final.stage };
  assert(final?.type === 'complete'); assert.equal(pageErrors, 0); assert.equal(rejectedRequests, 0);
  assert.deepEqual(final.proofs.map(proof => proof.circuit), names);
  assert(final.proofs.every(proof => proof.rawProofBytes > 0 && /^[a-f0-9]{64}$/.test(proof.sha256)));
  assert.equal(final.privateInputsGeneratedInsideWorker, true);
  assert.equal(final.negativeChecks.duplicateDonationRejectedBeforeProving, true);
  assert.equal(final.negativeChecks.wrongCircuitPreimageRejectedByZkirCheck, true);
  assert.equal(final.negativeChecks.wrongAssetRejectedBeforeProving, true);
  assert(final.mainThreadHeartbeats > 30);
  assert(final.largestHeartbeatGapMs < 2000, 'Main thread stalled while worker was proving');
  for (const circuit of names) {
    const start = report.events.find(event => event.type === 'progress' && event.circuit === circuit);
    const end = report.events.find(event => event.type === 'proof-completed' && event.circuit === circuit);
    assert(start && end && end.heartbeat - start.heartbeat >= 5);
  }
  assert(report.assets.filter(item => item.path.startsWith('assets/contract/') || item.path.startsWith('wasm/')).every(item => fetchedPaths.has(item.path)));
  Object.assign(report, { proofs: final.proofs, negativeChecks: final.negativeChecks,
    mainThreadHeartbeats: final.mainThreadHeartbeats, largestHeartbeatGapMs: final.largestHeartbeatGapMs,
    sharedWasmMemory: final.sharedWasmMemory, crossOriginIsolated: final.crossOriginIsolated,
    privateInputsGeneratedInsideWorker: final.privateInputsGeneratedInsideWorker, browserVersion: browser.version(),
    fetchedAssetPaths: [...fetchedPaths].sort(), responsivenessRequirement: 'At least five main-thread heartbeats during each proof; no heartbeat gap of 2 seconds or longer',
    status: 'passed', completedAt: new Date().toISOString(),
  });
  await page.screenshot({ path: join(artifacts, 'worker-complete.png') });
  output({ status: report.status, circuits: report.proofs.length, negativeChecks: report.negativeChecks,
    mainThreadHeartbeats: report.mainThreadHeartbeats, largestHeartbeatGapMs: report.largestHeartbeatGapMs,
    networkSubmission: false, realLaceWalletTested: false });
} catch {
  report.status = 'failed'; report.failureStage = stage;
  report.error = 'Worker proof test failed; private and environment details withheld';
  output({ status: 'failed', stage }); process.exitCode = 1;
} finally {
  await context?.close().catch(() => {}); await browser?.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, 'worker-evidence.json'), JSON.stringify(report, null, 2) + '\n');
}

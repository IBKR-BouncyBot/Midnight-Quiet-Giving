/** Remote-only deployment preparation check of the unmodified production bundle.
 * The API-4 fixture reports synthetic public identities and DUST. It refuses the
 * first proof/balancing request, and cannot sign or submit any transaction.
 */
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { createStaticServer } from './serve.mjs';

assert(process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true'
  && process.env.GITHUB_REPOSITORY === 'IBKR-BouncyBot/Midnight-Quiet-Giving',
'Run preparation diagnostics only on this project’s isolated GitHub runner');
const root = resolve(import.meta.dirname, '..');
const output = join(root, 'artifacts/network-preparation');
const indexer = 'https://indexer.preview.midnight.network/api/v4/graphql';
const report = { kind: 'production-browser-deployment-preparation', status: 'running', startedAt: new Date().toISOString(),
  sourceCommit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
  productionBundleUnmodified: true, productionModulesReplaced: false,
  productionEncryptedStorageProvider: true, actualCompiledContract: true,
  connectorFixture: true, reportedDustIsSynthetic: true, realWalletConnected: false,
  proofGenerated: false, networkTransactionSubmitted: false, networkAcceptance: false,
  secretMaterialExported: false, exceptions: [], requestedAssets: [], publicMetadataReads: [], unexpectedRequests: [] };
let stage = 'fixture-public-identity', server, browser, context, page, cdp;
const pendingReads = [];
const safeNames = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'DOMException',
  'ProviderFailedError', 'ComposeFailedError', 'ZkArtifactIntegrityError', 'ZkArtifactContractInfoError',
  'InvalidArgumentError', 'InvariantViolationError', 'EnvironmentUnsupportedError', 'ConfigurationError',
  'NativeTransactionReadinessError', 'NativeConnectionError', 'PasswordValidationError']);
function safeException(event) {
  const description = typeof event.data?.description === 'string' ? event.data.description : '';
  const firstLine = description.split('\n', 1)[0];
  const name = firstLine.split(':', 1)[0];
  const details = { name: safeNames.has(name) ? name : 'OtherError',
    functions: (event.callFrames ?? []).slice(0, 10).map(frame => frame.functionName)
      .filter(value => typeof value === 'string' && /^[A-Za-z_$][A-Za-z0-9_$ .<>-]{0,79}$/.test(value)) };
  // Only standard missing-member TypeErrors are exported. Any other message,
  // stack locations, scope objects, arguments and transaction data are omitted.
  if (details.name === 'TypeError') {
    const message = firstLine.replace(/^TypeError:\s*/, '');
    if (/^Cannot read properties of (?:undefined|null) \(reading '[A-Za-z_$][A-Za-z0-9_$]{0,39}'\)$/.test(message)
      || /^[A-Za-z_$][A-Za-z0-9_$ .]{0,99} is not a (?:function|constructor)$/.test(message)
      || /^Cannot convert undefined or null to object$/.test(message)) details.message = message;
  }
  if (details.name === 'ReferenceError') {
    const message = firstLine.replace(/^ReferenceError:\s*/, '');
    if (/^Cannot access '[A-Za-z_$][A-Za-z0-9_$]{0,39}' before initialization$/.test(message)
      || /^[A-Za-z_$][A-Za-z0-9_$]{0,39} is not defined$/.test(message)) details.message = message;
  }
  if (firstLine.includes('PREPARATION_TEST_STOP')) details.intentionalBoundaryStop = true;
  return details;
}
try {
  await mkdir(output, { recursive: true });
  const [{ ZswapSecretKeys }, addressFormat] = await Promise.all([
    import('@midnight-ntwrk/midnight-js-protocol/v9'), import('@midnightntwrk/wallet-sdk/address-format'),
  ]);
  const seed = randomBytes(32), keys = ZswapSecretKeys.fromSeed(seed);
  let identity;
  try {
    const coin = addressFormat.ShieldedCoinPublicKey.fromHexString(keys.coinPublicKey);
    const encryption = addressFormat.ShieldedEncryptionPublicKey.fromHexString(keys.encryptionPublicKey);
    identity = {
      shieldedAddress: addressFormat.MidnightBech32m.encode('preview', new addressFormat.ShieldedAddress(coin, encryption)).asString(),
      shieldedCoinPublicKey: addressFormat.ShieldedCoinPublicKey.codec.encode('preview', coin).asString(),
      shieldedEncryptionPublicKey: addressFormat.ShieldedEncryptionPublicKey.codec.encode('preview', encryption).asString(),
      // This is only an account namespace for temporary encrypted storage. No
      // wallet or signing key corresponding to this random address is created.
      unshieldedAddress: addressFormat.MidnightBech32m.encode('preview', new addressFormat.UnshieldedAddress(randomBytes(32))).asString(),
    };
  } finally { keys.clear(); seed.fill(0); }
  report.sourceHashes = Object.fromEntries(await Promise.all([
    'dist/network-bundle.mjs', 'dist/network-implementation.mjs', 'dist/network.html',
    'dist/network-contract/compiler/contract-manifest.json', 'scripts/build-network.mjs',
    'scripts/native-wasm-plugin.mjs', 'package-lock.json', 'scripts/test-network-preparation.mjs',
  ].map(async file => [file, createHash('sha256').update(await readFile(join(root, file))).digest('hex')])));
  stage = 'production-page-startup';
  server = createStaticServer({ directory: join(root, 'dist'), port: 0 }); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === new URL(base).origin && request.method() === 'GET') {
      if (url.pathname.startsWith('/network-contract/')) report.requestedAssets.push(url.pathname);
      return route.continue();
    }
    if (url.href === indexer && request.method() === 'POST') {
      let body; try { body = request.postDataJSON(); } catch { /* Refuse unknown payloads. */ }
      if (body?.operationName === 'HEAD_PROTOCOL_VERSION_QUERY'
        && /^query\s+HEAD_PROTOCOL_VERSION_QUERY\s*\{\s*block\s*\{\s*protocolVersion\s*(?:__typename\s*)?\}\s*\}$/.test(body.query?.trim() ?? '')
        && (!body.variables || Object.keys(body.variables).length === 0)) {
        report.publicMetadataReads.push({ operation: 'HEAD_PROTOCOL_VERSION_QUERY' });
        return route.continue();
      }
    }
    report.unexpectedRequests.push({ kind: url.origin === new URL(indexer).origin ? 'non-metadata-indexer-request' : 'other-request', method: request.method() });
    return route.abort('blockedbyclient');
  });
  context.on('response', response => {
    if (response.url() !== indexer) return;
    const record = report.publicMetadataReads.at(-1); if (!record) return;
    record.httpStatus = response.status();
    pendingReads.push((async () => { try {
      const data = await response.json();
      if (Number.isSafeInteger(data?.data?.block?.protocolVersion)) record.protocolVersion = data.data.block.protocolVersion;
      if (data.errors) record.graphqlError = true;
    } catch { record.responseUnreadable = true; } })());
  });
  // The browser connector is the sole fixture boundary. All production app,
  // provider, storage, compiler-manifest, ledger and constructor code is real.
  await context.addInitScript(({ identity, indexer }) => {
    const calls = { proofProviderAcquired: 0, proofCheck: 0, proofProve: 0, balance: 0, submit: 0, dustRead: 0 };
    let guard = null;
    const stop = boundary => {
      guard ??= boundary;
      throw new Error('PREPARATION_TEST_STOP');
    };
    const api = {
      async getConnectionStatus() { return { status: 'connected', networkId: 'preview' }; },
      async getConfiguration() { return { networkId: 'preview', indexerUri: indexer,
        indexerWsUri: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws', substrateNodeUri: 'https://rpc.preview.midnight.network' }; },
      async getShieldedAddresses() { const { shieldedAddress, shieldedCoinPublicKey, shieldedEncryptionPublicKey } = identity;
        return { shieldedAddress, shieldedCoinPublicKey, shieldedEncryptionPublicKey }; },
      async getUnshieldedAddress() { return { unshieldedAddress: identity.unshieldedAddress }; },
      async getDustBalance() { calls.dustRead++; return { cap: 1000000000000000000n, balance: 100000000000000000n }; },
      async getProvingProvider() {
        calls.proofProviderAcquired++;
        return { async check() { calls.proofCheck++; return stop('proof-check'); },
          async prove() { calls.proofProve++; return stop('proof-prove'); } };
      },
      async balanceUnsealedTransaction() { calls.balance++; return stop('wallet-balance'); },
      async balanceSealedTransaction() { calls.balance++; return stop('wallet-balance'); },
      async submitTransaction() { calls.submit++; return stop('unexpected-submit'); },
    };
    window.__networkPreparationTest = Object.freeze({ get guard() { return guard; }, calls });
    window.midnight = { 'preparation-fixture': { rdns: 'io.lace.wallet', name: 'Production preparation fixture (no wallet)',
      apiVersion: '4.1.0', async connect(networkId) { if (networkId !== 'preview') throw new Error('Fixture network mismatch'); return api; } } };
  }, { identity, indexer });
  page = await context.newPage(); page.setDefaultTimeout(25000);
  const pageErrors = [];
  page.on('pageerror', error => { pageErrors.push(safeNames.has(error.name) ? error.name : 'OtherError'); });
  page.on('dialog', dialog => dialog.accept());
  cdp = await context.newCDPSession(page);
  await cdp.send('Runtime.enable'); await cdp.send('Debugger.enable');
  await cdp.send('Debugger.setPauseOnExceptions', { state: 'all' });
  cdp.on('Debugger.paused', async event => {
    try {
      if (event.reason === 'exception' || event.reason === 'promiseRejection') {
        const summary = { phase: stage, ...safeException(event) };
        if (event.data?.objectId) {
          const properties = await cdp.send('Runtime.getProperties', { objectId: event.data.objectId, ownProperties: true });
          const code = properties.result.find(value => value.name === 'code')?.value?.value;
          if (typeof code === 'string' && /^MIDNIGHT_JS_[A-Z_]{1,100}$/.test(code)) summary.code = code;
        }
        report.exceptions.push(summary);
        if (report.exceptions.length > 60) { report.exceptions.shift(); report.earlierExceptionsOmitted = true; }
      }
    } catch { report.exceptionObservationIncomplete = true; }
    finally { await cdp.send('Debugger.resume').catch(() => {}); }
  });
  await page.goto(`${base}network.html`);
  await page.locator('#storage-password:enabled').waitFor();
  stage = 'real-provider-connection';
  await page.locator('#storage-password').fill('Temporary!RunnerStorage47');
  await page.locator('#internal-prover-confirmed').check();
  await page.locator('#connect-wallet').click();
  await page.locator('#disconnect:enabled').waitFor();
  await page.locator('#get-own-recipient').click();
  assert.match(await page.locator('#recipient-key').inputValue(), /^[0-9a-f]{64}$/);
  stage = 'real-deployment-preparation';
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__networkPreparationTest.guard !== null
    || (document.querySelector('#deploy-feedback')?.dataset.kind === 'error'
      && !document.querySelector('#deploy').disabled), null, { timeout: 90000 });
  await page.waitForFunction(() => !document.querySelector('#deploy').disabled);
  report.connectorCalls = await page.evaluate(() => ({ ...window.__networkPreparationTest.calls }));
  report.guard = await page.evaluate(() => window.__networkPreparationTest.guard);
  report.visibleStatus = await page.locator('#deploy-feedback').innerText();
  // Status is the app's fixed safe diagnostic, not a raw caught exception.
  assert(!report.visibleStatus.includes(identity.unshieldedAddress));
  report.indexedDbAvailable = await page.evaluate(async () => (await indexedDB.databases()).length > 0);
  report.pageErrors = pageErrors;
  report.requestedAssets = [...new Set(report.requestedAssets)].sort();
  await Promise.allSettled(pendingReads);
  await page.screenshot({ path: join(output, 'preparation-stop.png'), animations: 'disabled' });
  assert.equal(report.connectorCalls.submit, 0, 'The preparation harness must never submit');
  assert.deepEqual(report.unexpectedRequests, []);
  assert.deepEqual(pageErrors, []);
  assert(report.publicMetadataReads.some(value => value.protocolVersion >= 2000000), 'Current Preview protocol metadata was not observed');
  assert(['proof-check', 'proof-prove', 'wallet-balance'].includes(report.guard), 'Deployment failed before the guarded wallet boundary');
  report.status = 'passed'; report.completedAt = new Date().toISOString();
} catch {
  report.status = 'failed'; report.failureStage = stage;
  report.failure = 'Production preparation failed before the expected guarded wallet boundary; inspect curated exception metadata';
  await page?.screenshot({ path: join(output, 'preparation-failure.png'), animations: 'disabled' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await cdp?.send('Debugger.setPauseOnExceptions', { state: 'none' }).catch(() => {});
  await context?.close(); await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}

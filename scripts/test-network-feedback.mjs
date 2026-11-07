/** Remote-only UI regression test with controlled failure boundaries.
 * This tests the real page/event handlers, not a wallet, proof or network payment.
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createStaticServer } from './serve.mjs';

assert(process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true'
  && process.env.GITHUB_REPOSITORY === 'IBKR-BouncyBot/Midnight-Quiet-Giving',
'Run browser regression checks only on this project’s isolated GitHub runner');
const root = resolve(import.meta.dirname, '..');
const output = join(root, 'artifacts/network-feedback');
const directory = join(output, 'fixture');
const boundary = join(root, 'tests/network-feedback/boundaries.mjs');
const report = { kind: 'network-ui-failure-regression', status: 'running', startedAt: new Date().toISOString(),
  realApplicationUi: true, simulatedFailureBoundaries: true, realWalletConnected: false,
  proofGenerated: false, networkTransactionSubmitted: false, networkAcceptance: false, cases: [] };
let server, browser, context, page, stage = 'fixture-build';
try {
  await mkdir(directory, { recursive: true });
  await cp(join(root, 'src'), directory, { recursive: true });
  const result = await build({ absWorkingDir: root, entryPoints: [join(root, 'src/network-app.mjs')],
    outfile: join(directory, 'network-bundle.mjs'), bundle: true, format: 'esm', platform: 'browser',
    target: 'es2022', metafile: true, plugins: [{ name: 'test-only-network-failure-boundaries', setup(builder) {
      builder.onResolve({ filter: /(?:sdk-client|browser-providers|receipt|artifact-provider)\.mjs$/ }, () => ({ path: boundary }));
      builder.onResolve({ filter: /^@midnight-ntwrk\/midnight-js-indexer-public-data-provider$/ }, () => ({ path: boundary }));
    } }] });
  assert.equal(result.warnings.length, 0);
  assert(Object.keys(result.metafile.inputs).includes('src/network-app.mjs'));
  assert(Object.keys(result.metafile.inputs).includes('tests/network-feedback/boundaries.mjs'));
  assert(!Object.keys(result.metafile.inputs).some(name => name.startsWith('node_modules/')));
  assert(!Object.values(result.metafile.outputs).flatMap(item => item.imports).some(item => item.external));
  report.sourceHashes = Object.fromEntries(await Promise.all([
    'src/network-app.mjs', 'src/network-feedback.mjs', 'src/network.html', 'src/styles.css',
    'lib/network/wallet-readiness.mjs', 'lib/network/config.mjs',
    'tests/network-feedback/boundaries.mjs', 'scripts/test-network-feedback.mjs',
  ].map(async file => [file, createHash('sha256').update(await readFile(join(root, file))).digest('hex')])));
  // A visible label prevents screenshots of synthetic failure states being
  // mistaken for real wallet or network evidence.
  const html = await readFile(join(directory, 'network.html'), 'utf8');
  await writeFile(join(directory, 'network.html'), html.replace('</head>', '<link rel="stylesheet" href="./ui-fixture.css"></head>')
    .replace('</body>', '<aside class="ui-fixture-label">UI TEST · simulated failure · no wallet or transaction</aside></body>'));
  await writeFile(join(directory, 'ui-fixture.css'), '.ui-fixture-label{position:fixed;bottom:0;left:0;right:0;z-index:1000;background:#332700;color:#fff4ba;padding:6px;text-align:center;font:11px sans-serif;pointer-events:none}');
  server = createStaticServer({ directory, port: 0 }); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, serviceWorkers: 'block' });
  const errors = [], external = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(base)) return route.continue();
    external.push(new URL(route.request().url()).origin); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.clock.install();
  page.on('pageerror', () => errors.push('page-error'));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(`${base}network.html`);
  await page.locator('#storage-password:enabled').waitFor();
  await page.locator('#storage-password').fill('Synthetic!UiPassword09');
  await page.locator('#internal-prover-confirmed').check();
  await page.locator('#connect-wallet').click();
  await page.locator('#disconnect:enabled').waitFor();
  await page.locator('#recipient-key').fill('1'.repeat(64));
  await page.locator('#recipient-encryption-key').fill('2'.repeat(64));
  const deploy = page.locator('#deploy'), feedback = page.locator('#deploy-feedback');
  const originalLabel = await deploy.innerText();
  async function isVisibleWithinViewport() {
    const box = await feedback.boundingBox();
    assert(box && box.y >= 0 && box.y + box.height <= (await page.evaluate(() => innerHeight)) - 20,
      'Deployment feedback should be visible beside the clicked button');
  }
  for (const width of [1440, 390, 320]) {
    stage = `visible-readiness-failure-${width}`;
    await page.setViewportSize({ width, height: width === 1440 ? 1050 : 844 });
    await page.evaluate(() => window.__networkFeedbackTest.setMode('empty-dust'));
    const previous = await page.evaluate(() => window.__networkFeedbackTest.counts.readinessCalls);
    await deploy.scrollIntoViewIfNeeded(); await deploy.click();
    await page.waitForFunction(previous => window.__networkFeedbackTest.counts.readinessCalls === previous + 1, previous);
    await page.waitForFunction(() => window.__networkFeedbackTest.readinessPending);
    assert.equal(await deploy.isDisabled(), true);
    assert.equal(await deploy.getAttribute('aria-busy'), 'true');
    assert.notEqual(await deploy.innerText(), originalLabel);
    await feedback.filter({ hasText: /DUST|wallet/i }).waitFor();
    await isVisibleWithinViewport();
    // Even a synthetic duplicate DOM event must not start a second operation.
    await deploy.dispatchEvent('click');
    assert.equal(await page.evaluate(() => window.__networkFeedbackTest.counts.readinessCalls), previous + 1);
    await page.evaluate(() => window.__networkFeedbackTest.release());
    await feedback.filter({ hasText: /no DUST generation capacity/i }).waitFor();
    assert.match(await feedback.innerText(), /Last step:/);
    await page.waitForFunction(() => !document.querySelector('#deploy').disabled);
    assert.notEqual(await deploy.getAttribute('aria-busy'), 'true');
    assert.equal(await deploy.innerText(), originalLabel);
    assert.equal(await page.evaluate(() => window.__networkFeedbackTest.counts.deployCalls), 0);
    await isVisibleWithinViewport();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: join(output, `deploy-error-${width}.png`), animations: 'disabled' });
    report.cases.push(`Visible ${width}px in-panel readiness failure, busy control, duplicate suppression and safe retry enablement`);
  }
  for (const [mode, pattern] of [['wallet-rejected', /rejected/i], ['preparation-failed', /could not finish/i]]) {
    stage = mode;
    await page.evaluate(mode => window.__networkFeedbackTest.setMode(mode), mode);
    await deploy.click();
    await page.waitForFunction(() => document.querySelector('#deploy').disabled);
    await page.waitForFunction(() => window.__networkFeedbackTest.readinessPending);
    await page.evaluate(() => window.__networkFeedbackTest.release());
    await feedback.filter({ hasText: pattern }).waitFor();
    assert.match(await feedback.innerText(), /Last step:/);
    await page.waitForFunction(() => !document.querySelector('#deploy').disabled);
    assert(!(await page.locator('body').innerText()).includes('PRIVATE_FIXTURE_SENTINEL'));
    await isVisibleWithinViewport();
    report.cases.push(`${mode}: fixed safe error remains visible without exposing raw exception details`);
  }
  stage = 'bounded-readonly-timeout';
  const beforeTimeout = await page.evaluate(() => window.__networkFeedbackTest.counts.deployCalls);
  await page.evaluate(() => window.__networkFeedbackTest.setMode('empty-dust'));
  await deploy.click(); await page.waitForFunction(() => window.__networkFeedbackTest.readinessPending);
  await page.clock.runFor(15_050);
  await feedback.filter({ hasText: /did not answer the DUST balance check within 15 seconds/i }).waitFor();
  assert.equal(await deploy.isEnabled(), true);
  assert.equal(await page.evaluate(() => window.__networkFeedbackTest.counts.deployCalls), beforeTimeout);
  report.cases.push('Actual 15-second read-only DUST timeout is visible and prevents deployment');

  stage = 'slow-operation-feedback';
  await page.evaluate(() => window.__networkFeedbackTest.setMode('slow-preparation'));
  await deploy.click(); await page.waitForFunction(() => window.__networkFeedbackTest.readinessPending);
  await page.evaluate(() => window.__networkFeedbackTest.release());
  await page.waitForFunction(() => window.__networkFeedbackTest.deploymentPending);
  await page.clock.runFor(15_050);
  await feedback.locator('.action-wait-hint').filter({ hasText: /Still waiting/i }).waitFor();
  assert.equal(await deploy.isDisabled(), true);
  await page.evaluate(() => window.__networkFeedbackTest.releaseDeployment());
  await feedback.filter({ hasText: /could not finish/i }).waitFor();
  assert.equal(await deploy.isEnabled(), true);
  assert.equal(await feedback.locator('.action-wait-hint').count(), 0);
  report.cases.push('Long operation keeps busy feedback and gives a waiting hint without a duplicate submission');

  stage = 'final-privacy-checks';
  assert.equal(await page.evaluate(() => window.__networkFeedbackTest.counts.submittedTransactions), 0);
  assert.equal(await page.locator('#transaction-list').innerText(), 'No transaction started.');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  Object.assign(report, { status: 'passed', completedAt: new Date().toISOString(), browser: browser.version(), pageErrors: 0, externalRequests: 0 });
} catch {
  report.status = 'failed'; report.failureStage = stage; report.failure = 'UI regression assertions failed; private and environment details withheld';
  await page?.screenshot({ path: join(output, 'deploy-error-failure.png'), animations: 'disabled' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await context?.close(); await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}

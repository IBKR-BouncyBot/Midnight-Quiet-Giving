/** Actual reviewed Lace extension, disposable GitHub-hosted Linux runner only.
 * No injected wallet adapter, SDK wallet, user profile, exported seed, recording,
 * trace, screenshot or private receipt artifact. All approvals concern this fresh
 * Preview-only wallet. A faucet challenge is a blocker, never bypassed.
 */
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { chromium } from 'playwright';
import { createStaticServer } from './serve.mjs';

const root = resolve(import.meta.dirname, '..');
const reportDirectory = join(root, 'artifacts/lace-preview');
const extensionId = 'gafhhkghbfjjkeiendhlofajokpaflmk';
const extensionOrigin = `chrome-extension://${extensionId}`;
const faucetUrl = 'https://midnight-tmnight-preview.nethermind.dev/';
const report = { schema: 'private-donations/real-lace-preview/v1', startedAt: new Date().toISOString(),
  network: 'preview', extensionVersion: '2.5.1', extensionId, realExtension: false, injectedWalletAdapter: false,
  walletCreated: false, walletConnected: false, seedReadOrExported: false, internalWasmSelectedInUI: false,
  internalWasmAttestedByConnector: false, testNightFunded: false, testDustAvailable: false,
  acceptedTransactions: [], privateArtifactsSaved: false, governmentEndpointContacted: false,
  pageCrashObserved: false, unexpectedContextClosed: false, unexpectedBrowserDisconnected: false, extensionPageCloseCount: 0,
  observedExternalProofRequests: 0, status: 'running', stages: [] };
let stage = 'runner-prerequisites', context, server, profile, runnerRoot, app, wallet, password;
let cleaningUp = false;
let lastAction = '';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function save() { await mkdir(reportDirectory, { recursive: true }); await writeFile(join(reportDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
async function step(name, fn) {
  stage = name; report.currentStage = name; report.stages.push({ name, startedAt: new Date().toISOString() }); await save();
  process.stdout.write(JSON.stringify({ stage: name, status: 'started' }) + '\n');
  const value = await fn(); report.stages.at(-1).completed = true; await save(); return value;
}
async function control(name, operation) {
  report.currentControl = name; await save();
  process.stdout.write(JSON.stringify({ stage, control: name, status: 'started' }) + '\n');
  const result = await operation();
  report.lastCompletedControl = name; delete report.currentControl; await save();
  return result;
}
async function openSettings() {
  if (!await visible(wallet.getByTestId('settings-tab-btn'))) await control('open-main-menu', () => wallet.getByTestId('main-menu-tab-btn').click());
  await control('open-settings-tab', () => wallet.getByTestId('settings-tab-btn').click());
  await control('wait-for-settings-options', () => wallet.getByTestId('option-list-item-network').waitFor());
}
async function radioStructure() {
  return wallet.getByTestId('proof-server-in-process-radio').evaluate(node => [node, ...node.querySelectorAll('[data-testid], [role]')].slice(0, 20).map(element => ({
    tag: element.tagName,
    testId: element.getAttribute('data-testid'),
    role: element.getAttribute('role'),
    ariaSelected: element.getAttribute('aria-selected'),
    ariaChecked: element.getAttribute('aria-checked'),
    ariaDisabled: element.getAttribute('aria-disabled'),
  }))).catch(() => []);
}
async function clearRadioInteraction() {
  await wallet.getByTestId('proof-server-in-process-radio').press('Tab');
  await wallet.mouse.move(0, 0);
}
function navigationCategory(error) {
  const message = String(error?.message ?? '');
  if (/Target (page|context|browser).*closed|page has been closed|browser has been closed|context has been closed/i.test(message)) return 'browser-target-closed';
  if (/ERR_ABORTED|Navigation.*interrupted/i.test(message)) return 'navigation-aborted';
  if (/net::ERR_|Navigation failed/i.test(message)) return 'navigation-network-error';
  if (/Timeout|timeout/.test(message)) return 'bounded-stage-timeout';
  return null;
}
function safeExtensionRoute(page) {
  try {
    const url = new URL(page.url());
    if (`${url.protocol}//${url.host}` !== extensionOrigin) return null;
    return { path: url.pathname, queryParameterNames: [...new Set(url.searchParams.keys())].filter(name => /^[a-zA-Z0-9_-]{1,80}$/.test(name)) };
  } catch { return null; }
}
async function reloadWallet() {
  const previous = wallet;
  const observedUrl = previous.url();
  report.walletNavigationBefore = safeExtensionRoute(previous);
  if (!report.walletNavigationBefore) throw new Error('unexpected-wallet-navigation-origin');
  // Preserve the actual Lace URL rather than changing routes. A real extension
  // view transition may replace this page, so detect its replacement below.
  try { await previous.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); }
  catch (error) {
    const category = navigationCategory(error);
    if (!['browser-target-closed', 'navigation-aborted'].includes(category)) throw error;
    report.walletReloadTransition = category;
  }
  const replacementWaitStarted = Date.now();
  let fallbackOpened = false;
  await waitUntil(async () => {
    const pages = context.pages().filter(page => !page.isClosed() && page.url().startsWith(extensionOrigin));
    for (const page of [previous, ...pages.filter(page => page !== previous)]) {
      if (!page.isClosed() && await visible(page.getByTestId('main-menu-tab-btn'))) {
        wallet = page;
        report.walletPageReplacedOnReload = page !== previous;
        report.walletNavigationAfter = safeExtensionRoute(page);
        return true;
      }
    }
    // Lace's official openTabView uses an ordinary tab at its extension URL.
    // If a reload closes only that tab, keep the live app/context and reopen the
    // exact observed URL once instead of assuming Lace will recreate it itself.
    if (!fallbackOpened && previous.isClosed() && pages.length === 0 && Date.now() - replacementWaitStarted >= 5000
      && !report.unexpectedContextClosed && app && !app.isClosed()) {
      fallbackOpened = true;
      report.walletReloadFallbackOpened = true;
      const replacement = await context.newPage();
      try { await replacement.goto(observedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
      catch (error) {
        const category = navigationCategory(error);
        if (!['browser-target-closed', 'navigation-aborted'].includes(category)) throw error;
        report.walletReloadFallbackTransition = category;
      }
    }
    return false;
  }, 90000, 500);
}
async function proofSettingsControls() {
  return wallet.locator('[data-testid]').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().width && node.getBoundingClientRect().height)
    .filter(node => /^(proof-server-|midnight-settings-|save-configuration-button$|side-sheet-close-button$|authentication-prompt-)/.test(node.getAttribute('data-testid') ?? ''))
    .map(node => ({ testId: node.getAttribute('data-testid'), role: node.getAttribute('role'),
      ariaDisabled: node.getAttribute('aria-disabled'), disabled: node.hasAttribute('disabled'), focused: document.activeElement === node })).slice(0, 80)).catch(() => []);
}
async function completeProofSettingsSave() {
  const header = wallet.getByTestId('midnight-settings-sheet-header');
  const saveButton = wallet.getByTestId('save-configuration-button');
  // The reviewed settings effect emits its override and savingCompleted in one
  // sequence. Allow the connector round trip before inspecting the rendered
  // idle state; never dismiss an actively disabled/Saving form.
  await pause(2000);
  await waitUntil(async () => !await visible(header) || await visible(saveButton) && await saveButton.isEnabled(), 180000, 500);
  report.proofSettingsAfterSave = await proofSettingsControls();
  if (await visible(header)) {
    if (await visible(wallet.getByTestId('proof-server-disclosure-message'))) throw new Error('unexpected-proof-server-disclosure');
    report.proofSettingsSaveOutcome = 'save-control-enabled-after-dispatch';
  } else report.proofSettingsSaveOutcome = 'sheet-not-visible-after-save';
}
function within(parent, target) { const rel = relative(parent, target); return rel && !rel.startsWith('..') && !isAbsolute(rel); }
async function visible(locator) { return locator.isVisible().catch(() => false); }
async function firstClick(page, choices) {
  for (const choice of choices) {
    const locator = typeof choice === 'string' ? page.getByTestId(choice) : page.getByText(choice, { exact: true });
    if (await visible(locator.first())) { await locator.first().click(); return true; }
  }
  return false;
}
async function input(testId, value) {
  const target = wallet.getByTestId(testId);
  if (await target.evaluate(node => node.tagName === 'INPUT').catch(() => false)) await target.fill(value);
  else await target.locator('input').fill(value);
}
async function waitUntil(predicate, timeout = 90000, interval = 500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(interval); }
  throw new Error('bounded-stage-timeout');
}
async function approveWalletPages() {
  for (const page of context.pages().filter(page => page.url().startsWith(extensionOrigin))) {
    // Never open recovery/backup routes or collect their contents.
    if (await visible(page.getByTestId('recovery-phrase-words'))) throw new Error('unexpected-recovery-display');
    // Lace's authentication sheet overlays the still-visible connector/review
    // controls. Finish this exact prompt before touching anything behind it.
    const authentication = page.getByTestId('authentication-prompt-input-value');
    const authenticationConfirm = page.getByTestId('authentication-prompt-button-confirm');
    if (await visible(authentication) || await visible(authenticationConfirm)) {
      report.walletPromptState = 'authentication';
      if (await visible(authentication) && await authentication.isEditable()) await authentication.fill(password);
      if (await visible(authenticationConfirm) && await authenticationConfirm.isEnabled()) {
        await control('confirm-fresh-wallet-authentication', () => authenticationConfirm.click());
        lastAction = 'authentication-prompt-button-confirm';
      }
      return;
    }
    // The Midnight authorization page requires an explicit account selection,
    // even for the only account in this new disposable wallet.
    if (page.url().includes('midnight-authorize-dapp')) {
      const primary = page.getByTestId('dapp-connector-primary-button');
      const dropdown = page.getByTestId('dropdown-button');
      if (await visible(primary) && !await primary.isEnabled() && await visible(dropdown)) {
        report.walletPromptState = 'account-selection';
        const firstAccount = page.getByTestId('dropdown-menu-item-0');
        if (!await visible(firstAccount)) await control('open-fresh-midnight-account-menu', () => dropdown.click());
        await firstAccount.waitFor();
        if (await visible(page.getByTestId('dropdown-menu-item-1'))) throw new Error('unexpected-extra-account-in-fresh-wallet');
        await control('select-fresh-midnight-account', () => firstAccount.click());
        return;
      }
    }
    const fields = page.locator('input[type="password"]');
    if (await fields.count() === 1 && await visible(fields.first())) await fields.first().fill(password);
    const stageControls = stage === 'register-night-for-test-dust-in-lace' ? ['designate-button', 'confirm-designation-button'] : [];
    for (const id of [...stageControls, 'dapp-connector-primary-button', 'confirm-button', 'confirm-btn', 'sign-transaction-submit']) {
      const target = page.getByTestId(id);
      if (await visible(target) && await target.isEnabled()) {
        report.walletPromptState = 'approval';
        await control(`approve-wallet-${id}`, () => target.click()); lastAction = id; return;
      }
    }
    for (const label of [/^Connect$/, /^Approve$/, /^Confirm$/, /^Sign$/, /^Generate DUST$/, /^Generate dust$/, /^Confirm transaction$/]) {
      const target = page.getByRole('button', { name: label }).first();
      if (await visible(target) && await target.isEnabled()) {
        report.walletPromptState = 'approval';
        await control(`approve-wallet-${label.source.replace(/[^a-zA-Z]/g, '').toLowerCase()}`, () => target.click());
        lastAction = String(label); return;
      }
    }
  }
  report.walletPromptState = 'waiting';
}
async function runWithApprovals(operation, predicate, timeout = 480000) {
  await operation();
  await waitUntil(async () => { await approveWalletPages(); return predicate(); }, timeout, 750);
}
async function publicWalletState() {
  return app.evaluate(async () => {
    const api = window.__privateDonationsLaceAudit;
    if (!api) return null;
    const configuration = await api.getConfiguration();
    const status = await api.getConnectionStatus();
    const balances = await api.getUnshieldedBalances();
    const dust = await api.getDustBalance();
    return { network: configuration.networkId, connectedNetwork: status.networkId,
      unshieldedPositive: Object.values(balances).some(value => BigInt(value) > 0n), dust: String(dust.balance ?? dust.dustBalance ?? 0n) };
  });
}
async function collectTransactions() {
  const rows = await app.locator('#transaction-list li').evaluateAll(nodes => nodes.filter(node => node.querySelector('code')).map(node => ({
    operation: node.querySelector('strong')?.textContent ?? '', txId: node.querySelector('code')?.textContent ?? '',
    blockHeight: node.textContent.match(/at block (\d+)/)?.[1] ?? '', confirmationSource: 'configured-preview-indexer',
  })));
  for (const row of rows) {
    if (!/^[0-9a-f]{64}$/.test(row.txId) || !/^\d+$/.test(row.blockHeight)) throw new Error('invalid-public-evidence');
    if (!report.acceptedTransactions.some(item => item.txId === row.txId)) report.acceptedTransactions.push(row);
  }
  await save();
}
async function transact(id, completed, timeout = 480000) {
  await runWithApprovals(() => app.locator(`#${id}`).click(), async () => {
    await collectTransactions(); return completed();
  }, timeout);
}

try {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'linux' || !process.env.RUNNER_TEMP || !process.env.LACE_EXTENSION_PATH || !process.env.LACE_ACQUISITION_REPORT) throw new Error('isolated-github-runner-required');
  if (process.env.TEST_WALLET_SEED || process.env.MN_TEST_WALLET_SEED || process.env.WALLET_SEED || process.env.LACE_PASSWORD) throw new Error('external-wallet-credentials-refused');
  runnerRoot = await realpath(process.env.RUNNER_TEMP);
  const extension = await realpath(process.env.LACE_EXTENSION_PATH);
  assert.ok(within(runnerRoot, extension));
  const acquisition = JSON.parse(await readFile(process.env.LACE_ACQUISITION_REPORT, 'utf8'));
  assert.equal(acquisition.version, '2.5.1'); assert.equal(acquisition.extensionId, extensionId);
  assert.equal(acquisition.developerSignatureVerified, true); assert.equal(acquisition.webStorePublisherSignatureVerified, true);
  report.extensionArchiveSha256 = acquisition.archiveSha256;
  report.runnerSourceSha256 = createHash('sha256').update(await readFile(import.meta.filename)).digest('hex');
  profile = await mkdtemp(join(runnerRoot, 'private-donations-lace-profile-'));
  password = `P8!${randomBytes(32).toString('base64url')}zQ`;
  server = createStaticServer({ port: 0 });
  await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await step('load-reviewed-real-extension', async () => {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: false, viewport: { width: 1280, height: 960 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run'],
      acceptDownloads: false, locale: 'en-US' });
    context.setDefaultTimeout(20000);
    context.on('close', () => { if (!cleaningUp) report.unexpectedContextClosed = true; });
    context.browser()?.on('disconnected', () => { if (!cleaningUp) report.unexpectedBrowserDisconnected = true; });
    const trackedPages = new WeakSet();
    const trackPageLifecycle = page => {
      if (trackedPages.has(page)) return;
      trackedPages.add(page);
      page.on('crash', () => { if (!cleaningUp) report.pageCrashObserved = true; });
      page.on('close', () => { if (!cleaningUp && page.url().startsWith(extensionOrigin)) report.extensionPageCloseCount++; });
    };
    context.pages().forEach(trackPageLifecycle);
    context.on('page', trackPageLifecycle);
    context.on('request', request => {
      try { const url = new URL(request.url()); if (/proofserver|prover/i.test(url.hostname) && !['127.0.0.1', 'localhost'].includes(url.hostname)) report.observedExternalProofRequests++; } catch { /* no payloads */ }
    });
    const worker = context.serviceWorkers().find(worker => worker.url().startsWith(extensionOrigin)) ?? await context.waitForEvent('serviceworker', { timeout: 90000 });
    assert.ok(worker.url().startsWith(extensionOrigin)); report.realExtension = true;
    // Keep a normal application tab open throughout extension window transitions.
    app = await context.newPage(); await app.goto(`${origin}/network.html`);
    wallet = context.pages().find(page => page.url().startsWith(extensionOrigin)) ?? await context.newPage();
    if (!wallet.url().startsWith(extensionOrigin)) await wallet.goto(`${extensionOrigin}/expo/index.html`);
    await wallet.getByTestId('onboarding-start-create-wallet-button').waitFor({ timeout: 90000 });
  });
  await step('create-fresh-ephemeral-wallet', async () => {
    await wallet.getByTestId('onboarding-start-create-wallet-button').click();
    await input('new-password-input', password); await input('confirm-password-input', password);
    await wallet.getByTestId('next-btn').click();
    const midnight = wallet.getByTestId('onboarding-create-wallet-toggle-midnight');
    await midnight.waitFor();
    const checked = await midnight.getAttribute('aria-checked');
    if (checked !== 'true') await midnight.click();
    await wallet.getByTestId('onboarding-create-wallet-finish-button').click();
    await wallet.getByTestId('main-menu-tab-btn').waitFor({ timeout: 180000 });
    report.walletCreated = true;
  });
  await step('select-preview-network-in-lace', async () => {
    await openSettings();
    await control('open-network-settings', () => wallet.getByTestId('option-list-item-network').click());
    await control('select-testnet-network-type', () => wallet.getByTestId('network-selection-sheet-network-type-radio-group').getByText('Testnet', { exact: true }).click());
    const midnightGroup = wallet.locator('[data-testid="network-selection-sheet-radio-group-Midnight"], [data-testid="network-selection-sheet-radio-group-midnight"]');
    await control('select-midnight-preview', () => midnightGroup.getByText('Preview', { exact: true }).click());
    await control('confirm-preview-network', () => wallet.getByTestId('network-selection-sheet-confirm-button').click());
    await control('wait-for-network-sheet-to-close', () => wallet.getByTestId('network-selection-sheet-header').waitFor({ state: 'hidden' }));
    report.previewSelectedInUI = true;
  });
  await step('select-real-internal-wasm-proving', async () => {
    if (!await visible(wallet.getByTestId('option-list-item-midnight'))) await openSettings();
    await control('open-midnight-settings', () => wallet.getByTestId('option-list-item-midnight').click());
    const radio = wallet.getByTestId('proof-server-in-process-radio');
    await control('select-internal-wasm-radio', () => radio.click());
    // This Lace bundle drops accessibilityState in its React Native Web layer.
    // Its checkmark is shown for selected OR focused OR hovered radios, so clear
    // both interaction states before inspecting the source-defined checkmark.
    await control('clear-radio-hover-and-focus', clearRadioInteraction);
    await control('verify-internal-wasm-selection', () => wallet.getByTestId('proof-server-in-process-radio-checkmark').waitFor());
    report.selectedProofControlStructure = await radioStructure();
    await control('save-internal-wasm-setting', () => wallet.getByTestId('save-configuration-button').click());
    await control('complete-internal-wasm-settings-save', completeProofSettingsSave);
    // A new page mount discards the settings component's local useState value.
    // The following selection therefore comes from the persisted wallet config.
    await control('reload-wallet-to-verify-persisted-proving', reloadWallet);
    await control('wait-for-reloaded-wallet', () => wallet.getByTestId('main-menu-tab-btn').waitFor({ timeout: 90000 }));
    await openSettings();
    await control('reopen-midnight-settings-to-check-persistence', () => wallet.getByTestId('option-list-item-midnight').click());
    await control('wait-for-persisted-proof-settings', () => wallet.getByTestId('proof-server-in-process-radio').waitFor());
    await control('clear-persisted-radio-hover-and-focus', clearRadioInteraction);
    await control('verify-persisted-internal-wasm-selection', () => wallet.getByTestId('proof-server-in-process-radio-checkmark').waitFor());
    report.persistedProofControlStructure = await radioStructure();
    await control('reload-wallet-after-persistence-check', reloadWallet);
    await control('wait-for-verified-wallet-page', () => wallet.getByTestId('main-menu-tab-btn').waitFor({ timeout: 90000 }));
    report.internalWasmSelectionEvidence = 'persisted-unfocused-unhovered-radio-checkmark';
    report.internalWasmSelectedInUI = true;
  });
  await step('connect-actual-lace-to-donation-page', async () => {
    await app.bringToFront();
    await app.waitForFunction(() => [...document.querySelectorAll('#wallet-select option')].some(option => option.value && /Lace/.test(option.textContent)), undefined, { timeout: 90000 });
    await app.locator('#storage-password').fill(`A7!${randomBytes(32).toString('base64url')}qR`);
    await app.locator('#internal-prover-confirmed').check();
    await runWithApprovals(() => app.locator('#connect-wallet').click(), async () => /Lace connected/.test(await app.locator('#connection-status').textContent()), 180000);
    // Use the real injected connector for public balance observations only.
    let connectorFinished = false, connectorError = false;
    const connected = app.evaluate(async () => {
      const wallet = Object.values(window.midnight ?? {}).find(value => value?.rdns === 'io.lace.wallet' && /^4\./.test(value.apiVersion));
      if (!wallet) throw new Error('actual-lace-api-missing'); window.__privateDonationsLaceAudit = await wallet.connect('preview');
      return window.__privateDonationsLaceAudit.getUnshieldedAddress();
    }).then(value => { connectorFinished = true; return value; }, () => { connectorFinished = true; connectorError = true; });
    await waitUntil(async () => { await approveWalletPages(); return connectorFinished; }, 120000);
    if (connectorError) throw new Error('actual-lace-connector-failed');
    const address = (await connected).unshieldedAddress;
    assert.match(address, /^mn_addr_preview1[a-z0-9]+$/);
    report.freshTestAddress = address; report.walletConnected = true;
    const configuration = await app.evaluate(() => window.__privateDonationsLaceAudit.getConfiguration());
    assert.equal(configuration.networkId, 'preview');
  });
  await step('request-free-preview-night-from-official-faucet', async () => {
    const faucet = await context.newPage(); await faucet.goto(faucetUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await control('fill-official-faucet-address', () => faucet.locator('#address').fill(report.freshTestAddress));
    const button = faucet.getByRole('button', { name: 'Request tokens', exact: true });
    // The official site may complete its managed browser verification itself.
    // Wait for its genuine enabled submit control; never solve a challenge,
    // inject a captcha token or call an alternate/bypassing request endpoint.
    await control('wait-for-official-faucet-ready', async () => {
      try { await waitUntil(() => button.isEnabled(), 90000, 1000); }
      catch {
        const challengePresent = await faucet.locator('iframe[src*="captcha"], iframe[src*="challenges.cloudflare"], .g-recaptcha, .h-captcha, .cf-turnstile, #cf-turnstile').count() > 0;
        const completedNormally = await faucet.locator('input[name="cf-turnstile-response"]').evaluateAll(nodes => nodes.some(node => node.value.length > 0));
        report.faucetChallengePresent = challengePresent; report.faucetBrowserVerificationCompleted = completedNormally;
        throw new Error(challengePresent && !completedNormally ? 'public-faucet-human-challenge' : 'public-faucet-service-unavailable');
      }
    });
    report.faucetSubmitEnabledNormally = true;
    await control('request-preview-test-tokens', () => button.click()); report.faucetRequested = true;
    await waitUntil(async () => {
      const rejected = await faucet.getByText(/too many requests|rate limit|already requested|daily limit/i).count() > 0;
      if (rejected) throw new Error('public-faucet-rate-limit');
      const state = await publicWalletState(); return state?.unshieldedPositive === true;
    }, 360000, 5000);
    report.testNightFunded = true; await faucet.close();
  });
  await step('register-night-for-test-dust-in-lace', async () => {
    await reloadWallet();
    const generate = wallet.getByTestId('account-card-generate-dust-button').first();
    await generate.waitFor({ timeout: 120000 });
    await runWithApprovals(() => generate.click(), async () => {
      const state = await publicWalletState(); return state && BigInt(state.dust) > 0n;
    }, 480000);
    report.testDustAvailable = true;
  });
  await step('deploy-preview-donation-contract-with-lace', async () => {
    await app.locator('#get-own-recipient').click(); await app.locator('#recipient-label').fill('Fresh Preview test wallet');
    await transact('deploy', () => app.locator('#lock-contract').isEnabled());
  });
  await step('lock-contract-rules-with-lace', async () => { await transact('lock-contract', () => app.locator('#mint').isEnabled()); });
  await step('mint-valueless-donation-token-with-lace', async () => {
    const before = report.acceptedTransactions.length;
    await transact('mint', () => report.acceptedTransactions.length > before && app.locator('#donate-network').isEnabled());
    await waitUntil(() => app.evaluate(async () => Object.values(await window.__privateDonationsLaceAudit.getShieldedBalances()).some(value => BigInt(value) >= 125n)), 240000, 3000);
  });
  await step('donate-and-create-private-receipt-with-real-lace', async () => {
    await app.locator('#taxpayer-label').fill('CI-DEMO-TAXPAYER'); await app.locator('#donation-amount').fill('125');
    await transact('donate-network', () => app.locator('#export-private').isEnabled(), 600000);
    assert.equal(report.observedExternalProofRequests, 0);
  });
  await step('independently-verify-private-opening-against-preview-record', async () => {
    await app.locator('#verify-disclosure').click();
    await waitUntil(async () => /Private opening \+ indexed donation verified/.test(await app.locator('#authority-status').textContent()), 120000);
    report.authorityDemoVerified = true; report.selfRecipientMechanicsOnly = true;
    report.status = 'passed'; report.completedAt = new Date().toISOString(); delete report.currentStage; await save();
  });
} catch (error) {
  report.status = 'failed'; report.failedStage = stage;
  const message = String(error?.message ?? '');
  report.failureCategory = /human-challenge/.test(message) ? 'official-faucet-requires-human-challenge'
    : /faucet-rate-limit/.test(message) ? 'official-faucet-rate-limit'
    : /faucet-service-unavailable/.test(message) ? 'official-faucet-service-unavailable'
    : navigationCategory(error) ?? (/credential|runner|recovery/.test(message) ? 'isolated-runner-safety-boundary' : 'stage-failed');
  report.lastApprovedControl = lastAction || null;
  if (wallet) {
    report.failedProofControlStructure = await radioStructure();
    report.focusedProofSettingsDiagnostics = await proofSettingsControls();
  }
  // Structural diagnostics only: no body text, input values, screenshots or logs.
  if (wallet) report.visibleExtensionControls = await wallet.locator('[data-testid]').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().width && node.getBoundingClientRect().height)
    .map(node => node.getAttribute('data-testid')).filter(value => /^[a-zA-Z0-9_-]{1,100}$/.test(value)).slice(0,100)).catch(() => []);
  if (context) report.extensionPageDiagnostics = await Promise.all(context.pages().filter(page => page.url().startsWith(extensionOrigin)).map(async (page, index) => ({
    index,
    route: safeExtensionRoute(page),
    visibleControls: await page.locator('[data-testid]').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().width && node.getBoundingClientRect().height)
      .map(node => node.getAttribute('data-testid')).filter(value => /^[a-zA-Z0-9_-]{1,100}$/.test(value)).slice(0, 100)).catch(() => []),
    authenticationVisible: await visible(page.getByTestId('authentication-prompt-input-value')),
    connectorApprovalVisible: await visible(page.getByTestId('dapp-connector-primary-button')),
  })));
  if (app) {
    await collectTransactions().catch(() => {});
    report.applicationStatus = await app.locator('#network-status').textContent().catch(() => null);
  }
  await save(); process.exitCode = 1;
} finally {
  cleaningUp = true;
  password = undefined;
  await context?.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
  if (profile && runnerRoot && within(runnerRoot, profile) && profile.startsWith(join(runnerRoot, 'private-donations-lace-profile-'))) await rm(profile, { recursive: true, force: true });
  report.ephemeralProfileRemoved = Boolean(profile); await save();
  process.stdout.write(JSON.stringify({ status: report.status, failedStage: report.failedStage, failureCategory: report.failureCategory,
    realExtension: report.realExtension, walletCreated: report.walletCreated, walletConnected: report.walletConnected,
    acceptedTransactions: report.acceptedTransactions.length, evidence: 'artifacts/lace-preview/report.json' }) + '\n');
}

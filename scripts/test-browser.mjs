import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createStaticServer } from './serve.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'artifacts/browser');
await mkdir(output, { recursive: true });
const prefix = '/Midnight-Quiet-Giving';
const server = createStaticServer({ port: 0, prefix });
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}${prefix}/`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [], external = [], cases = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
await context.route('**/*', route => {
  const url = route.request().url();
  if (url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
  external.push(new URL(url).origin); return route.abort();
});
async function download(id) {
  const pending = page.waitForEvent('download'); await page.locator(id).click();
  return JSON.parse(await readFile(await (await pending).path(), 'utf8'));
}
async function layout(name) {
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1050 : 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${name} overflows at ${width}px`);
    if (width !== 320) await page.screenshot({ path: resolve(output, `${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
}
try {
  await page.goto(base);
  await page.getByRole('heading', { level: 1 }).waitFor();
  assert.match(await page.title(), /Quiet Giving/);
  assert(await page.locator('a[href="./browser.html"]').count());
  assert(await page.locator('a[href="./network.html"]').count());
  const palette = await page.evaluate(() => ({ blue: getComputedStyle(document.documentElement).getPropertyValue('--blue').trim(), font: getComputedStyle(document.body).fontFamily }));
  assert.equal(palette.blue, '#0000fe'); assert.match(palette.font, /Outfit/);
  await layout('landing'); cases.push('Landing, matching Midnight/Outfit styling, both demo routes, desktop and 320px/390px layout');

  await page.goto(`${base}browser.html`);
  await page.locator('#donate:enabled').waitFor();
  assert.match(await page.locator('#boot-status').innerText(), /Compact|Midnight|local/i);
  await page.locator('#donor-alias').fill('DEMO-ALICE');
  await page.locator('#amount').fill('125');
  await page.locator('#donate').click();
  await page.waitForFunction(() => document.querySelector('#recipient-total').textContent === '125');
  assert.equal(await page.locator('#share-proof').isEnabled(), true);
  assert(!await page.locator('#authority-status').innerText().then(text => text.includes('DEMO-ALICE')));
  assert(!await page.locator('#public-record').innerText().then(text => text.includes('DEMO-ALICE')));
  assert(!await page.locator('#recipient-record').innerText().then(text => text.includes('DEMO-ALICE')));
  const publicReceipt = await download('#download-public');
  const privateReceipt = await download('#download-private');
  assert.equal(privateReceipt.taxpayerId, 'DEMO-ALICE');
  assert.equal(privateReceipt.amount, 125);
  assert.match(privateReceipt.donorSecret, /^[0-9a-f]{64}$/);
  for (const secret of [privateReceipt.donorSecret, privateReceipt.receiptSalt, 'DEMO-ALICE']) assert(!JSON.stringify(publicReceipt).includes(secret));
  assert(!Object.hasOwn(publicReceipt, 'amount'));
  cases.push('Native donation, recipient privacy, deliberate share boundary and separate public/private downloads');

  await page.locator('#share-proof').click();
  await page.waitForFunction(() => document.querySelector('#authority-details').textContent.includes('DEMO-ALICE'));
  assert(!await page.locator('#recipient-record').innerText().then(text => text.includes('DEMO-ALICE')));
  assert(!await page.locator('#public-record').innerText().then(text => text.includes('DEMO-ALICE')));
  await page.locator('#tamper-receipt').click();
  await page.locator('#tamper-status').filter({ hasText: /reject|does not match|detected/i }).waitFor();
  await page.locator('#private-file').setInputFiles({ name: 'test-private-receipt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(privateReceipt)) });
  await page.locator('#import-status').filter({ hasText: /match|verified|valid/i }).waitFor();
  const tampered = structuredClone(privateReceipt); tampered.taxpayerId = 'DEMO-MALLORY';
  await page.locator('#private-file').setInputFiles({ name: 'tampered-private-receipt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tampered)) });
  await page.locator('#import-status').filter({ hasText: /reject|does not match|invalid/i }).waitFor();
  cases.push('Explicit authority disclosure, changed amount rejection, valid receipt import and identity tampering rejection');
  await layout('browser-donation');

  await page.locator('#donor-alias').fill('DEMO-BOB'); await page.locator('#amount').fill('75'); await page.locator('#donate').click();
  await page.waitForFunction(() => document.querySelector('#recipient-total').textContent === '200');
  assert(!await page.locator('#authority-details').innerText().then(text => text.includes('DEMO-BOB')));
  const second = await download('#download-private');
  assert.notEqual(second.donorSecret, privateReceipt.donorSecret); assert.notEqual(second.receiptSalt, privateReceipt.receiptSalt);
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  assert(!storage.includes(privateReceipt.donorSecret)); assert(!storage.includes(second.donorSecret));
  await page.locator('#reset-demo').click();
  await page.waitForFunction(() => document.querySelector('#recipient-total').textContent === '0');
  assert.equal(await page.locator('#share-proof').isDisabled(), true);
  cases.push('Second donor, fresh receipt material, no automatic second disclosure, memory-only private state and reset');

  await page.goto(`${base}network.html`);
  await page.locator('#refresh-wallets:enabled').waitFor();
  assert.equal(await page.locator('#mint').isDisabled(), true);
  assert.equal(await page.locator('#deploy').isDisabled(), true);
  assert.equal(await page.locator('#disconnect').isDisabled(), true);
  await page.locator('#refresh-wallets').click();
  assert.equal(await page.locator('#wallet-select option').count(), 1);
  await layout('network');
  cases.push('Actual network bundle/WASM startup and unavailable-wallet actions fail closed; no mocked success');
  assert.deepEqual(errors, [], 'Browser JavaScript errors');
  assert.deepEqual(external, [], 'No unsolicited external requests in local browser acceptance');
  const report = { checkedAt: new Date().toISOString(), browser: await browser.version(), cases, pageErrors: errors.length,
    nativeCompactExecution: true, generatedZkProof: false, realLaceExtension: false, networkTransactionSubmitted: false };
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve));
}

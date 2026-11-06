import { createNetworkClient, validateJoinFile, verifyIndexedDisclosure } from '../lib/network/sdk-client.mjs';
import { connectNativeBrowserProviders, nativeStoragePasswordMessage, nativeConnectionErrorMessage } from '../lib/network/browser-providers.mjs';
import { findNativeWallets, NETWORK_DEFAULTS, nativeNetworkErrorMessage, resolveNativeBrowserConfig } from '../lib/network/config.mjs';
import { checkPreviewPublicServices, formatPreviewServiceError } from '../lib/network/public-testnet.mjs';
import { verifyDisclosure } from '../lib/receipt.mjs';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';

const $ = id => document.getElementById(id);
const text = (id, value) => { const node = $(id); if (node) node.textContent = value; };
const status = value => text('network-status', value);
const ownErrors = new WeakSet();
const state = { ready: false, busy: false, connection: null, client: null, record: null, wallets: [], disclosure: null, joinDetails: null, selectedReceipt: null, savedPrivate: false };
function invalid(message) { const error = new Error(message); ownErrors.add(error); throw error; }
function hex(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value) || /^0+$/.test(value)) invalid(`${label} must be 64 lowercase hexadecimal characters and cannot be zero.`);
  return value;
}
function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function syncControls() {
  for (const node of document.querySelectorAll('[data-ready]')) node.disabled = !state.ready || state.busy;
  for (const node of document.querySelectorAll('[data-connected]')) node.disabled = !state.connection || state.busy;
  for (const node of document.querySelectorAll('[data-contract]')) node.disabled = !state.record || state.busy;
  const connected = Boolean(state.connection), selected = Boolean(state.client?.contractAddress);
  for (const id of ['wallet-select', 'refresh-wallets', 'storage-password', 'internal-prover-confirmed']) $(id).disabled = connected || state.busy;
  $('disconnect').disabled = !connected || state.busy;
  const connectButton = $('connect-form').querySelector('button[type="submit"]');
  if (connectButton) connectButton.disabled = connected || state.busy || state.wallets.length === 0 || !$('internal-prover-confirmed').checked;
  $('deploy').disabled = !connected || selected || state.busy;
  $('join').disabled = !connected || selected || state.busy;
  $('get-own-recipient').disabled = !connected || selected || state.busy;
  $('lock-contract').disabled = !state.record || state.record.rulesLocked || state.busy;
  $('mint').disabled = !state.record?.rulesLocked || state.busy || Boolean(state.client?.pendingDonation);
  const donateButton = $('donation-form').querySelector('button[type="submit"]');
  if (donateButton) donateButton.disabled = !state.record?.rulesLocked || state.busy || Boolean(state.client?.pendingDonation);
  $('export-private').disabled = !state.disclosure || state.busy;
  $('export-public').disabled = !state.selectedReceipt || state.busy;
  $('verify-disclosure').disabled = !state.disclosure || state.busy;
  $('recover-donation').disabled = !state.client?.pendingDonation || state.busy;
  for (const id of ['recipient-key', 'recipient-encryption-key', 'recipient-label', 'contract-address', 'join-file']) $(id).disabled = selected || state.busy;
  if ($('refresh-state')) $('refresh-state').disabled = !selected || state.busy;
}
function addText(parent, tag, value, className) {
  const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; parent.append(node); return node;
}
function noteTransaction(label, result) {
  if (!result?.txId || result.blockHeight === undefined) invalid('Accepted transaction evidence is missing. Refresh the contract before trying again.');
  if (!$('transaction-list').textContent.includes(result.txId)) {
    const row = document.createElement('li');
    addText(row, 'strong', label); addText(row, 'span', ` · indexer-confirmed at block ${result.blockHeight}`);
    addText(row, 'code', result.txId); $('transaction-list').prepend(row);
  }
  text('network-tx', result.txId);
  status(`${label} accepted by the configured Preview indexer at block ${result.blockHeight}.`);
}
function capturePrivate() {
  const packet = state.client?.lastPrivateDisclosure;
  if (packet) { state.disclosure = packet; state.savedPrivate = false; }
}
async function action(fn) {
  if (state.busy) return;
  state.busy = true; syncControls(); status('Working…');
  const previous = state.client?.lastAcceptedTransaction?.txId;
  try { await fn(); }
  catch (error) {
    capturePrivate();
    const accepted = state.client?.lastAcceptedTransaction;
    if (accepted?.txId && accepted.txId !== previous) {
      noteTransaction('Transaction', accepted);
      status('The transaction was accepted, but its follow-up check did not finish. Refresh contract state or recover the pending donation. Do not repeat the payment.');
    } else {
      status(ownErrors.has(error) ? error.message : nativeStoragePasswordMessage(error) ?? nativeConnectionErrorMessage(error) ?? formatPreviewServiceError(error) ?? nativeNetworkErrorMessage(error));
      if (state.client?.pendingDonation) status('The donation may have been sent. Keep this tab open, download its private receipt, and use Recover donation before sending another.');
    }
  } finally { state.busy = false; syncControls(); }
}
const on = (id, handler, event = 'click') => {
  const node = $(id); if (node) node.addEventListener(event, ev => { ev.preventDefault(); void action(() => handler(ev)); });
};
function refreshWallets() {
  state.wallets = findNativeWallets().filter(entry => entry.rdns === 'io.lace.wallet');
  $('wallet-select').replaceChildren();
  for (const entry of state.wallets) { const option = document.createElement('option'); option.value = entry.id; option.textContent = `${entry.name} · API ${entry.apiVersion}`; $('wallet-select').append(option); }
  if (!state.wallets.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'Lace is not available in this browser'; $('wallet-select').append(option); }
  text('connection-status', state.wallets.length ? 'Lace found. Choose Preview and Run in this app (WASM) in its settings.' : 'Install or unlock Lace in this browser, enable Midnight Preview, and refresh wallets. The browser demo works without a wallet.');
  syncControls();
}
const STAGES = {
  'connection-settings': 'Checking Preview settings…', 'connection-permission': 'Approve the app connection in Lace…',
  'connection-account': 'Reading the wallet’s public account information…', 'connection-network': 'Checking the Preview connection…',
  'connection-internal-prover': 'Checking the Lace connector and your proving-mode confirmation…', 'connection-storage': 'Opening encrypted application key storage…',
  'connection-providers': 'Preparing Midnight providers…', 'connection-proving-provider': 'Preparing Lace proving…',
  'wallet-connected': 'Lace connected. No transaction submitted.', 'proving-provider-started': 'Preparing the contract proof in Lace…',
  'proving-provider-completed': 'Proof provider completed. Waiting for wallet balancing…', 'wallet-approval-requested': 'Review and approve this Preview transaction in Lace…',
  'wallet-balanced': 'Lace balanced the transaction using test DUST…', 'submission-returned': 'Transaction submitted. Waiting for the Preview indexer…',
};
async function connect() {
  const entry = state.wallets.find(value => value.id === $('wallet-select').value);
  if (!entry) invalid('Choose an installed Lace wallet.');
  const password = $('storage-password').value;
  const connection = await connectNativeBrowserProviders({ wallet: entry.wallet, configuration: NETWORK_DEFAULTS.preview,
    passwordProvider: async () => password, internalProverConfirmed: $('internal-prover-confirmed').checked,
    onStage: stage => { if (STAGES[stage]) status(STAGES[stage]); } });
  try { state.client = createNetworkClient(connection.providers, { networkId: connection.networkId, compiledAssetsPath: connection.compiledAssetsPath, assertSession: connection.assertSession }); }
  catch (error) { connection.close(); throw error; }
  state.connection = connection; $('storage-password').value = '';
  text('connection-status', 'Lace connected · Preview · internal WASM selected by you');
  status('Connected. Set the recipient’s two public keys, deploy, then lock the donation rules. You can also import a public campaign file.');
}
function scene(mode) { if ($('network-scene')) $('network-scene').dataset.state = mode; }
function renderReceipts() {
  $('receipt-list').replaceChildren();
  for (const receipt of state.record?.receipts ?? []) {
    const row = document.createElement('article'); row.className = 'receipt-row';
    addText(row, 'strong', 'Anonymous donation commitment');
    addText(row, 'code', receipt.receiptId); addText(row, 'p', 'The public receipt contains no taxpayer label or private opening.');
    const select = addText(row, 'button', 'Select public receipt', 'button secondary'); select.type = 'button';
    select.addEventListener('click', () => { state.selectedReceipt = receipt; syncControls(); status('Public receipt selected for download.'); });
    $('receipt-list').append(row);
  }
  if (!state.record?.receipts.length) addText($('receipt-list'), 'p', 'No donation receipts in this campaign yet.');
}
async function refreshState() {
  state.record = await state.client.readState();
  const r = state.record;
  $('contract-address').value = r.contractAddress; $('recipient-key').value = r.recipientKey; $('recipient-encryption-key').value = r.recipientEncryptionKey; $('recipient-label').value = r.recipientLabel;
  text('network-contract', r.contractAddress);
  text('contract-summary', `${r.recipientLabel} · ${r.rulesLocked ? 'Rules locked permanently' : 'Lock the rules before donations'} · ${r.totalDonations} recorded donation${r.totalDonations === 1 ? '' : 's'} · ${r.totalMints} faucet operation${r.totalMints === 1 ? '' : 's'}.`);
  renderReceipts(); return r;
}
async function readFile(id) {
  const file = $(id).files?.[0]; if (!file) invalid('Choose a JSON file first.');
  if (file.size > 100_000) invalid('The maximum file size is 100 KB.');
  try { return JSON.parse(await file.text()); } catch { invalid('The selected file is not valid JSON.'); }
}
function recipientFields() {
  const recipientLabel = $('recipient-label').value.trim();
  if (!recipientLabel || recipientLabel.length > 80) invalid('Enter a recipient label of 1 to 80 characters.');
  return { recipientKey: hex($('recipient-key').value.trim(), 'Recipient coin key'), recipientEncryptionKey: hex($('recipient-encryption-key').value.trim(), 'Recipient encryption key'), recipientLabel };
}
on('refresh-wallets', () => { refreshWallets(); status('Wallet discovery refreshed.'); });
on('connect-form', connect, 'submit');
on('disconnect', () => {
  if (state.disclosure && !state.savedPrivate) invalid('Save your private receipt before disconnecting. This session holds its only copy.');
  state.connection?.close(); state.connection = null; state.client = null; state.record = null; state.joinDetails = null; state.selectedReceipt = null;
  // Explicit disconnect clears private data as advertised. Export before using it.
  state.disclosure = null; state.savedPrivate = false;
  for (const id of ['storage-password', 'recipient-key', 'recipient-encryption-key', 'contract-address', 'taxpayer-label', 'private-file', 'join-file']) $(id).value = '';
  $('internal-prover-confirmed').checked = false;
  text('connection-status', 'Disconnected. Wallet permissions and encrypted app storage are unchanged.');
  text('contract-summary', 'No campaign selected.'); text('authority-status', 'No private disclosure loaded.');
  renderReceipts(); scene('idle'); status('Disconnected and cleared private receipt data from this page.');
});
on('check-services', async () => {
  text('service-status', 'Checking public Preview services…');
  try { const result = await checkPreviewPublicServices(); text('service-status', `Preview responded at block ${result.blockHeight}. No wallet connected or transaction sent.`); status('Public Preview connectivity check completed.'); }
  catch (error) { text('service-status', formatPreviewServiceError(error) ?? 'Preview services are unavailable.'); throw error; }
});
on('get-own-recipient', () => {
  const keys = state.client.getRecipientKeys(); $('recipient-key').value = keys.recipientKey; $('recipient-encryption-key').value = keys.recipientEncryptionKey;
  status('Your connected wallet is selected as the recipient. Use another wallet to make a donation between separate people.');
});
on('deploy', async () => { const result = await state.client.deploy(recipientFields()); noteTransaction('Donation contract deployed', result); await refreshState(); status('Contract deployed. Lock its rules before minting test tokens or donating.'); });
on('lock-contract', async () => {
  const result = await state.client.lockRules(); if (!result.alreadyLocked) noteTransaction('Donation rules locked', result);
  await refreshState(); status('Donation rules are locked. Mint valueless test tokens to your connected donor wallet, then make a donation.');
});
on('join-file', async () => {
  let details; try { details = validateJoinFile(await readFile('join-file')); } catch { invalid('This is not a valid Preview donation campaign file.'); }
  state.joinDetails = details;
  for (const [id, key] of [['contract-address', 'contractAddress'], ['recipient-key', 'recipientKey'], ['recipient-encryption-key', 'recipientEncryptionKey'], ['recipient-label', 'recipientLabel']]) $(id).value = details[key];
  status('Public campaign details loaded. Verify both recipient public keys through a trusted channel, then join to check the contract.');
}, 'change');
on('join', async () => {
  const contractAddress = hex($('contract-address').value.trim(), 'Contract address');
  await state.client.join({ contractAddress, ...recipientFields(), ...(state.joinDetails?.contractAddress === contractAddress ? { campaignId: state.joinDetails.campaignId } : {}) });
  await refreshState(); status('Campaign and contract verifier keys checked against the Preview indexer. No transaction sent.');
});
on('export-join', () => { download('donation-campaign.public.json', state.client.exportJoinFile()); status('Public campaign file downloaded. It contains recipient public keys, not donor identity or private openings.'); });
on('mint', async () => { const result = await state.client.mint(1000); noteTransaction('1,000 test donation tokens minted', result); await refreshState(); status('The faucet transaction was accepted. Wait for Lace to synchronize its test-token balance before donating.'); });
on('donation-form', async () => {
  if (state.disclosure && !state.savedPrivate) invalid('Save your private receipt before making another donation. This session holds its only copy.');
  const units = Number($('donation-amount').value);
  if (!Number.isSafeInteger(units) || units < 1 || units > 1_000_000) invalid('Choose a whole amount from 1 through 1,000,000 test tokens.');
  const taxpayerId = $('taxpayer-label').value.trim();
  if (!taxpayerId || taxpayerId.length > 80 || /[\u0000-\u001f\u007f]/.test(taxpayerId)) invalid('Use a demonstration taxpayer label with 1 to 80 characters. Do not enter an actual tax identification number.');
  const result = await state.client.donate({ amount: units, taxpayerId });
  capturePrivate(); state.selectedReceipt = result.receipt;
  if (result.transaction) noteTransaction('Private donation', result.transaction);
  await refreshState(); scene('donated'); text('network-donor-amount', `${units} TEST`); text('network-recipient-amount', `+${units} TEST`);
  text('authority-status', 'Your receipt is ready. Download the private disclosure or deliberately verify it in the authority demo.');
  status('Donation receipt matched the indexed contract. Save your private disclosure: your Lace seed cannot recreate it.');
}, 'submit');
on('recover-donation', async () => {
  const result = await state.client.recoverPendingDonation(); capturePrivate(); state.selectedReceipt = result.receipt;
  if (result.transaction) noteTransaction('Recovered donation', result.transaction);
  await refreshState(); scene('donated'); status('The pending donation matches the indexed contract. No replacement donation was sent. Save your private disclosure.');
});
on('refresh-state', async () => { await refreshState(); status('Contract state refreshed from the Preview indexer.'); });
on('export-private', () => {
  if (!state.disclosure) invalid('No private receipt is available.');
  download('donation-tax-disclosure.PRIVATE.json', state.disclosure); state.savedPrivate = true;
  status('Private disclosure downloaded. It contains the taxpayer label and receipt secrets. Share it only with the intended verifier.');
});
on('export-public', () => { if (!state.selectedReceipt) invalid('Select a public receipt first.'); download('donation-receipt.public.json', state.selectedReceipt); status('Public receipt downloaded without private identity or opening.'); });
on('private-file', async () => {
  if (state.disclosure && !state.savedPrivate) {
    // Clear the rejected selection so the same file can be selected after backup.
    $('private-file').value = '';
    invalid('Save your current private receipt before loading another. This session holds its only copy.');
  }
  const packet = await readFile('private-file'); const checked = await verifyDisclosure(packet);
  if (!checked.valid || packet.receipt.mode !== 'network' || packet.receipt.networkId !== 'preview') invalid('This file is not a valid Preview private donation disclosure.');
  state.disclosure = packet; state.savedPrivate = true;
  text('authority-status', 'Private file loaded in this browser. Verify to check the locked contract and receipt against the Preview indexer.'); status('Private disclosure loaded. Its private fields have not been sent to any service.');
}, 'change');
on('verify-disclosure', async () => {
  if (!state.disclosure) invalid('Make a donation or import its private disclosure first.');
  const config = resolveNativeBrowserConfig(NETWORK_DEFAULTS.preview, location.href);
  const publicDataProvider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri, globalThis.WebSocket);
  const zkConfigProvider = new FetchZkConfigProvider(config.compiledAssetsUrl, (url, init) => {
    const target = new URL(url), base = new URL(config.compiledAssetsUrl);
    if (target.origin !== base.origin || !target.pathname.startsWith(`${base.pathname}/`)) throw new Error('Asset request outside this app');
    return fetch(target.href, { ...init, redirect: 'error', credentials: 'same-origin' });
  });
  const result = await verifyIndexedDisclosure(state.disclosure, { publicDataProvider, zkConfigProvider, networkId: 'preview' });
  const panel = $('authority-status'); panel.replaceChildren();
  if (!result.valid || !result.included || !result.indexedDonationMatched) { addText(panel, 'p', 'Verification did not find a matching donation in the locked contract.'); scene('donated'); return; }
  addText(panel, 'strong', 'Private opening + indexed donation verified');
  addText(panel, 'p', `${result.disclosed.taxpayerId} · ${result.disclosed.amount} valueless TEST tokens`);
  addText(panel, 'p', `Donation window: ${new Date(result.disclosed.validFrom * 1000).toLocaleString()} to ${new Date(result.disclosed.validUntil * 1000).toLocaleString()}`);
  addText(panel, 'p', result.message);
  text('network-authority-state', 'Receipt matched'); scene('verified');
  status('Authority demo check completed locally. Only the public contract address was queried; no private taxpayer data or opening was sent to the indexer or a government service.');
});
$('internal-prover-confirmed').addEventListener('change', syncControls);
window.addEventListener('beforeunload', event => {
  if (state.busy || state.client?.pendingDonation || (state.disclosure && !state.savedPrivate)) {
    event.preventDefault(); event.returnValue = '';
  }
});
window.addEventListener('pageshow', () => { if (!state.connection) { $('internal-prover-confirmed').checked = false; syncControls(); } });
state.ready = true; refreshWallets();
status('Preview client ready. Connect Lace to transact, or import a private receipt to verify it without a wallet. Nothing is sent automatically.');

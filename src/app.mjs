/* Browser-only UI. All roles share this tab; no network or tax authority is contacted. */
const $ = id => document.getElementById(id);
const recipientLabels = {community:'Community kitchen',education:'Open learning fund',relief:'Emergency relief'};
let lab = null, latest = null, shared = null, busy = false;
const boot = $('boot-status');
const stringify = value => JSON.stringify(value, null, 2);
const number = value => new Intl.NumberFormat('en').format(value);
const shortId = value => `${value.slice(0,10)}…${value.slice(-8)}`;

function status(element, message, state = '') {
  element.textContent = message;
  element.dataset.state = state;
}
function ready() {
  for (const id of ['donor-alias','recipient','amount','donate','reset-demo','private-file']) $(id).disabled = !lab || busy;
  for (const id of ['share-proof','download-private','download-public','tamper-receipt']) $(id).disabled = !latest || busy;
  $('donate').textContent = busy ? 'Checking donation…' : 'Donate privately →';
}
function bootMessage(message, type = '') {
  boot.textContent = message;
  boot.className = `notice${type ? ` ${type}` : ''}`;
}
function save(value, name) {
  const objectUrl = URL.createObjectURL(new Blob([stringify(value)], {type:'application/json'}));
  const link = document.createElement('a');
  link.href = objectUrl; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
function currentRecipient() {
  const id = $('recipient').value;
  const state = lab.getState();
  const recipient = state.recipientTotals.find(value => value.id === id);
  $('recipient-name').textContent = recipientLabels[id];
  $('recipient-total').textContent = number(recipient?.total ?? 0);
  $('recipient-message').dataset.active = recipient?.total > 0 ? 'true' : 'false';
  $('recipient-message').textContent = recipient?.total > 0
    ? 'Thank you! Your donation helps this cause. The donor’s taxpayer label remains private.'
    : 'Your first donation will appear here. The recipient never sees your taxpayer label.';
  $('recipient-record').textContent = stringify({recipient:recipientLabels[id],illustrativeTestTokensReceived:recipient?.total ?? 0,donorIdentity:'not disclosed',taxReceiptOpening:'not disclosed'});
}
function render() {
  currentRecipient();
  const record = lab.exportPublicRecord();
  $('public-record').textContent = stringify(record);
  $('receipt-empty').hidden = Boolean(latest);
  $('receipt-details').hidden = !latest;
  if (latest) {
    $('receipt-amount').textContent = `${number(latest.amount)} illustrative test tokens`;
    $('receipt-recipient').textContent = latest.recipientName;
    $('receipt-donor').textContent = latest.opening.taxpayerId;
    $('receipt-id').textContent = shortId(latest.receipt.receiptId);
    $('receipt-id').title = latest.receipt.receiptId;
  }
  ready();
}
async function operation(action) {
  if (busy || !lab) return;
  busy = true; ready();
  try { await action(); }
  catch (error) {
    // Only known application validation messages are shown; no object dumps or private inputs.
    bootMessage(error instanceof Error ? error.message : 'The local operation could not be completed.', 'error');
    $('donation-scene').dataset.state = shared ? 'verified' : latest ? 'donated' : 'idle';
  } finally { busy = false; ready(); }
}
function showAuthority(result) {
  if (!result.valid || !result.included) {
    status($('authority-status'),'Receipt not verified.','error');
    $('authority-details').textContent = result.message;
    return false;
  }
  shared = result.disclosed;
  $('donation-scene').dataset.state = 'verified';
  status($('authority-status'),'Receipt matches.','success');
  const details = $('authority-details'); details.replaceChildren();
  for (const line of [shared.taxpayerId,`${number(shared.amount)} test tokens`,shared.recipientName,shared.date]) {
    if (!line) continue;
    const element = document.createElement('div'); element.textContent = String(line); details.append(element);
  }
  $('authority-record').textContent = stringify({verification:'matches local session record',...shared,identityStatus:'self-entered demo label; not legally verified',taxAcceptance:'not assessed'});
  return true;
}

$('donation-form').addEventListener('submit', event => {
  event.preventDefault();
  operation(async () => {
    const amount = Number($('amount').value), label = $('donor-alias').value.trim();
    if (!label || label.length > 40) throw new Error('Enter an invented taxpayer label of 1 to 40 characters.');
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) throw new Error('Choose a whole amount from 1 to 1,000,000 test tokens.');
    $('donation-scene').dataset.state = 'donating';
    const result = await lab.donate({donor:label,taxpayerId:label,amount,recipient:$('recipient').value});
    latest = result;
    shared = null;
    $('donation-scene').dataset.state = 'donated';
    status($('authority-status'),'Your receipt is ready.');
    $('authority-details').textContent = 'Share it when you choose.';
    $('authority-record').textContent = 'The latest donation has not been shared with the verifier.';
    status($('tamper-status'),''); status($('import-status'),'');
    bootMessage('Donation checked locally. The recipient view shows the illustrative tokens; your taxpayer label stays private.','success');
    render();
  });
});
$('recipient').addEventListener('change', () => { if (lab) currentRecipient(); });
$('share-proof').addEventListener('click', () => operation(async () => {
  if (!latest) return;
  $('donation-scene').dataset.state = 'verifying';
  const result = await lab.verifyDisclosure(lab.createDisclosure(latest.receipt.receiptId));
  if (showAuthority(result)) bootMessage('Private receipt shared with the local authority demo. Its values match this session’s donation commitment.','success');
  else throw new Error(result.message);
}));
$('tamper-receipt').addEventListener('click', () => operation(async () => {
  if (!latest) return;
  const packet = structuredClone(lab.createDisclosure(latest.receipt.receiptId));
  packet.amount = packet.amount + 1;
  const result = await lab.verifyDisclosure(packet);
  if (result.valid) {
    status($('tamper-status'),'Unexpected result: changed amount was accepted. Do not rely on this receipt.','error');
    bootMessage('The tamper check did not reject the changed amount.','error');
  } else {
    status($('tamper-status'),`Rejected as expected: ${number(packet.amount)} does not match the original ${number(latest.amount)}-token commitment. Your real receipt is unchanged.`,'success');
  }
}));
$('download-private').addEventListener('click', () => {
  if (latest) save(lab.createDisclosure(latest.receipt.receiptId),`PRIVATE-donation-${latest.receipt.receiptId.slice(0,8)}.json`);
});
$('download-public').addEventListener('click', () => {
  if (latest) save(latest.receipt,`public-donation-${latest.receipt.receiptId.slice(0,8)}.json`);
});
$('private-file').addEventListener('change', () => operation(async () => {
  const file = $('private-file').files?.[0];
  if (!file) return;
  if (file.size > 128 * 1024) throw new Error('Choose a private receipt file smaller than 128 KB.');
  let packet;
  try { packet = JSON.parse(await file.text()); } catch { throw new Error('That file does not contain valid receipt JSON.'); }
  const result = await lab.verifyDisclosure(packet);
  status($('import-status'),result.valid && result.included ? 'Receipt matches a donation in this local session.' : `Receipt not accepted: ${result.message}`,result.valid && result.included ? 'success' : 'error');
  if (result.valid && result.included) showAuthority(result);
  $('private-file').value = '';
}));
$('reset-demo').addEventListener('click', () => operation(async () => {
  const native = await import('./native.js');
  lab = await native.createDonationLab(); latest = null; shared = null;
  $('donation-scene').dataset.state = 'idle';
  status($('authority-status'),'Waiting for your permission.');
  $('authority-details').replaceChildren();
  $('authority-record').textContent = 'No information shared.';
  status($('tamper-status'),''); status($('import-status'),'');
  $('private-file').value = '';
  bootMessage('Fresh local session ready. No wallet, tokens or network connection needed.');
  render();
}));
const tabs = ['public','recipient','authority'];
function selectTab(name, focus = false) {
  for (const tab of tabs) {
    $(`${tab}-tab`).setAttribute('aria-selected',String(tab===name));
    $(`${tab}-tab`).tabIndex = tab===name ? 0 : -1;
    $(`${tab}-panel`).hidden = tab!==name;
  }
  if (focus) $(`${name}-tab`).focus();
}
for (const [index,name] of tabs.entries()) {
  $(`${name}-tab`).addEventListener('click', () => selectTab(name));
  $(`${name}-tab`).addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = tabs[(index+1)%tabs.length];
    if (event.key === 'ArrowLeft') next = tabs[(index+tabs.length-1)%tabs.length];
    if (event.key === 'Home') next = tabs[0];
    if (event.key === 'End') next = tabs.at(-1);
    if (next) { event.preventDefault(); selectTab(next,true); }
  });
}
try {
  const native = await import('./native.js');
  lab = await native.createDonationLab();
  bootMessage('Ready to explore. Actual Compact checks run locally; no wallet, real money or network transaction is involved.');
  render();
} catch {
  bootMessage('The generated Midnight contract could not load. Refresh the page, or check that the complete app build is being served.','error');
}

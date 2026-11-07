import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeHarness, createDonationLab, randomHex32, bytes, hex, taxpayerDigestFor, verifyDisclosure, commitmentForDisclosure, validatePublicReceipt, validatePublicRecord } from '../lib/native-engine.mjs';

const NOW = 1_799_395_200;
async function fixture() {
  const native = await createNativeHarness({ now: NOW });
  const coin = { nonce: bytes(randomHex32()), color: native.pure.testTokenColor(bytes(native.contractAddress)), value: 125n };
  const id = bytes(randomHex32());
  const inputs = { donorSecret: bytes(randomHex32()), taxpayerDigest: bytes(await taxpayerDigestFor('DEMO-TAXPAYER')), receiptSalt: bytes(randomHex32()) };
  const args = [coin, id, BigInt(NOW), BigInt(NOW + 1200)];
  return { native, coin, id, inputs, args, donate: () => native.call('donate', args, inputs) };
}
async function labFixture() {
  const lab = await createDonationLab({ now: NOW });
  const donation = await lab.donate({ donor: 'Alice', taxpayerId: 'DEMO-ALICE', amount: 125, recipient: 'community' });
  return { lab, donation, packet: lab.createDisclosure(donation.receipt.receiptId) };
}

test('generated Compact executes a full shielded transfer to the immutable recipient', async () => {
  const { native, coin, id, donate } = await fixture();
  const result = await donate();
  const zswap = result.context.callContext.currentZswapLocalState;
  assert.equal(native.state().totalDonations, 1n);
  assert.equal(native.state().receipts.member(id), true);
  assert.equal(zswap.inputs.length, 1);
  assert.equal(zswap.inputs[0].value, 125n);
  const recipientOutputs = zswap.outputs.filter(item => item.recipient.is_left);
  assert.equal(recipientOutputs.length, 1);
  assert.equal(hex(recipientOutputs[0].recipient.left.bytes), native.recipientKey);
  assert.equal(recipientOutputs[0].coinInfo.value, 125n);
  assert.equal(hex(recipientOutputs[0].coinInfo.color), hex(coin.color));
  assert.notEqual(hex(recipientOutputs[0].coinInfo.nonce), hex(coin.nonce));
});

test('contract rejects wrong tokens and invalid amounts without recording a receipt', async () => {
  for (const changes of [{ color: bytes(randomHex32()) }, { value: 0n }, { value: 1000001n }]) {
    const { native, coin, args, inputs } = await fixture();
    await assert.rejects(() => native.call('donate', [{ ...coin, ...changes }, ...args.slice(1)], inputs), /test token|Donation amount/);
    assert.equal(native.state().totalDonations, 0n);
    assert.equal(native.state().receipts.size(), 0n);
  }
});

test('receipt ids and donation nonces cannot be reused', async () => {
  const { native, coin, args, inputs, donate } = await fixture();
  await donate();
  await assert.rejects(donate, /Receipt id already used/);
  await assert.rejects(() => native.call('donate', [coin, bytes(randomHex32()), ...args.slice(2)], inputs), /coin nonce already used/);
  assert.equal(native.state().totalDonations, 1n);
});

test('concurrent async circuit calls cannot reuse a receipt or lose state updates', async () => {
  const { native, coin, args, inputs, donate } = await fixture();
  const results = await Promise.allSettled([donate(), donate()]);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']);
  assert.match(results[1].reason.message, /Receipt id already used/);
  const next = [
    { ...coin, nonce: bytes(randomHex32()) }, bytes(randomHex32()), ...args.slice(2),
  ];
  await native.call('donate', next, inputs);
  assert.equal(native.state().totalDonations, 2n);
  assert.equal(native.state().receipts.size(), 2n);
});

test('contract rejects missing private evidence and empty receipt/coin identifiers', async () => {
  for (const field of ['donorSecret', 'taxpayerDigest', 'receiptSalt']) {
    const { native, args, inputs } = await fixture();
    await assert.rejects(() => native.call('donate', args, { ...inputs, [field]: new Uint8Array(32) }), /required/);
    assert.equal(native.state().totalDonations, 0n);
  }
  const { native, coin, args, inputs } = await fixture();
  await assert.rejects(() => native.call('donate', [coin, new Uint8Array(32), ...args.slice(2)], inputs), /Receipt id required/);
  await assert.rejects(() => native.call('donate', [{ ...coin, nonce: new Uint8Array(32) }, ...args.slice(1)], inputs), /Fresh donation coin required/);
});

test('block time and a bounded validity window are constrained by the contract', async () => {
  const { native, coin, id, inputs } = await fixture();
  await assert.rejects(() => native.call('donate', [coin, id, BigInt(NOW + 1), BigInt(NOW + 1200)], inputs), /outside its validity window/);
  await assert.rejects(() => native.call('donate', [coin, id, BigInt(NOW - 1200), BigInt(NOW)], inputs), /outside its validity window/);
  await assert.rejects(() => native.call('donate', [coin, id, BigInt(NOW), BigInt(NOW + 1801)], inputs), /at most thirty minutes/);
  await assert.rejects(() => native.call('donate', [coin, id, BigInt(NOW), BigInt(NOW)], inputs), /at most thirty minutes/);
  assert.equal(native.state().totalDonations, 0n);
});

test('test faucet mints its own token, checks limits and prevents nonce reuse', async () => {
  const native = await createNativeHarness({ now: NOW });
  const receiver = { bytes: bytes(randomHex32()) }, nonce = bytes(randomHex32());
  const result = await native.call('mint', [receiver, 500n, nonce]);
  const output = result.context.callContext.currentZswapLocalState.outputs[0];
  assert.equal(output.coinInfo.value, 500n);
  assert.equal(hex(output.coinInfo.color), hex(native.pure.testTokenColor(bytes(native.contractAddress))));
  assert.equal(hex(output.recipient.left.bytes), hex(receiver.bytes));
  assert.equal(native.state().totalMints, 1n);
  await assert.rejects(() => native.call('mint', [receiver, 500n, nonce]), /nonce already used/);
  await assert.rejects(() => native.call('mint', [receiver, 1000001n, bytes(randomHex32())]), /Mint amount/);
  await assert.rejects(() => native.call('mint', [{ bytes: new Uint8Array(32) }, 500n, bytes(randomHex32())]), /Recipient key/);
});

test('browser lab supports two donors and separate recipients with real commitments', async () => {
  const { lab, donation, packet } = await labFixture();
  await lab.donate({ donor: 'Bob', taxpayerId: 'DEMO-BOB', amount: 75, recipient: 'community' });
  await lab.donate({ donor: 'Alice', taxpayerId: 'DEMO-ALICE', amount: 50, recipient: 'education' });
  assert.equal(lab.getState().totalDonations, 3);
  assert.equal(lab.getState().recipientTotals[0].total, 200);
  assert.equal(lab.getState().recipientTotals[1].total, 50);
  const result = await lab.verifyDisclosure(packet);
  assert.equal(result.valid, true);
  assert.equal(result.included, true);
  assert.equal(result.paymentVerified, false);
  assert.equal(result.taxAccepted, false);
  assert.equal(result.disclosed.taxpayerId, 'DEMO-ALICE');
  assert.equal(result.disclosed.recipientName, 'Community kitchen');
  assert.equal(await commitmentForDisclosure(packet), donation.receipt.commitment);
});

test('private disclosure binds amount, identity, date, secret, randomness and receipt scope', async () => {
  const { lab, packet } = await labFixture();
  for (const change of [
    { amount: 126 }, { taxpayerId: 'DEMO-MALLORY' }, { validFrom: packet.validFrom + 1 },
    { validUntil: packet.validUntil + 1 }, { donorSecret: randomHex32() }, { receiptSalt: randomHex32() },
    { receipt: { ...packet.receipt, recipientKey: randomHex32() } },
    { receipt: { ...packet.receipt, campaignId: randomHex32() } },
    { receipt: { ...packet.receipt, contractAddress: randomHex32() } },
    { receipt: { ...packet.receipt, receiptId: randomHex32() } },
  ]) assert.equal((await lab.verifyDisclosure({ ...packet, ...change })).valid, false);
});

test('recomputed forged commitment is not treated as a completed donation', async () => {
  const { lab, packet } = await labFixture();
  const forged = structuredClone(packet);
  forged.amount = 999;
  forged.receipt.commitment = await commitmentForDisclosure(forged);
  // A matching opening alone proves internal consistency, not a chain payment.
  const standalone = await verifyDisclosure(forged);
  assert.equal(standalone.valid, true);
  assert.equal(standalone.included, false);
  assert.equal(standalone.paymentVerified, false);
  assert.equal((await lab.verifyDisclosure(forged)).valid, false);
  const anotherLab = await createDonationLab({ now: NOW });
  assert.equal((await anotherLab.verifyDisclosure(packet)).valid, false);
});

test('public export omits donor identity, amount, private opening and proof witnesses', async () => {
  const { lab, packet } = await labFixture();
  const record = lab.exportPublicRecord();
  const text = JSON.stringify(record);
  for (const value of ['Alice', 'DEMO-ALICE', packet.donorSecret, packet.receiptSalt, 'taxpayerId', 'amount', 'donorSecret', 'receiptSalt', 'proofData']) assert.equal(text.includes(value), false);
  assert.equal(validatePublicRecord(record), record);
  assert.equal((await verifyDisclosure(packet, record)).included, true);
  record.receipts[0].commitment = randomHex32();
  assert.notEqual(lab.exportPublicRecord().receipts[0].commitment, record.receipts[0].commitment);
});

test('import validation rejects private fields in public records and malformed disclosures', async () => {
  const { lab, packet } = await labFixture();
  const record = lab.exportPublicRecord();
  assert.throws(() => validatePublicRecord({ ...record, donorSecret: 'private' }), /unexpected fields/);
  assert.throws(() => validatePublicRecord({ ...record, receipts: [...record.receipts, record.receipts[0]] }), /Duplicate/);
  for (const malformed of [null, [], { ...packet, hidden: 'private' }, { ...packet, amount: '125' }, { ...packet, amount: Number.MAX_SAFE_INTEGER + 1 }, { ...packet, donorSecret: 'x' }, { ...packet, taxpayerId: '\u0000' }]) {
    assert.equal((await verifyDisclosure(malformed)).valid, false);
  }
  const networkClaim = { ...packet, receipt: { ...packet.receipt, networkId: 'preview', txId: randomHex32() } };
  assert.equal((await verifyDisclosure(networkClaim)).valid, false);
  const mainnet = { ...packet, receipt: { ...packet.receipt, mode: 'network', networkId: 'mainnet' } };
  assert.equal((await verifyDisclosure(mainnet)).valid, false);
});

test('each donation uses fresh private receipt material even for the same taxpayer', async () => {
  const { lab, packet } = await labFixture();
  const next = await lab.donate({ donor: 'Alice', taxpayerId: 'DEMO-ALICE', amount: 125, recipient: 'community' });
  assert.notEqual(next.opening.donorSecret, packet.donorSecret);
  assert.notEqual(next.opening.receiptSalt, packet.receiptSalt);
  assert.notEqual(next.receipt.commitment, packet.receipt.commitment);
  const clone = lab.getOpening(next.receipt.receiptId); clone.taxpayerId = 'changed';
  assert.equal(lab.getOpening(next.receipt.receiptId).taxpayerId, 'DEMO-ALICE');
});

test('network receipts accept ledger transaction identifiers without confusing them with hashes', async () => {
  const { packet } = await labFixture();
  const receipt = { ...packet.receipt, mode: 'network', networkId: 'preview', txId: `00${randomHex32()}`, blockHeight: '123' };
  assert.equal(validatePublicReceipt(receipt), receipt);
  assert.equal((await verifyDisclosure({ ...packet, receipt })).valid, true);
  for (const txId of [randomHex32(), '0'.repeat(66), 'AB'.repeat(33), `0x${receipt.txId}`, 12, `${receipt.txId}ff`]) {
    assert.throws(() => validatePublicReceipt({ ...receipt, txId }), /Transaction id/);
  }
});

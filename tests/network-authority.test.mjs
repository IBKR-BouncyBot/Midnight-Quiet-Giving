import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeHarness, randomHex32, bytes, hex, taxpayerDigestFor, createDisclosure } from '../lib/native-engine.mjs';
import { verifyIndexedDisclosure, validateJoinFile, createNetworkClient } from '../lib/network/sdk-client.mjs';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

// Generated Compact execution with a deliberately synthetic indexer wrapper.
// These are verifier-boundary tests, not proof generation or chain settlement.
async function fixture() {
  const time = 1800000000;
  const native = await createNativeHarness({ now: time });
  const donorSecret = randomHex32(), receiptSalt = randomHex32(), receiptId = randomHex32();
  const taxpayerId = 'Example claimant', digest = await taxpayerDigestFor(taxpayerId);
  const coin = { nonce: bytes(randomHex32()), color: native.pure.testTokenColor(bytes(native.contractAddress)), value: 75n };
  const result = native.call('donate', [coin, bytes(receiptId), BigInt(time), BigInt(time + 1200)],
    { donorSecret: bytes(donorSecret), receiptSalt: bytes(receiptSalt), taxpayerDigest: bytes(digest) });
  const receipt = { version: 1, kind: 'donation-public-receipt', mode: 'network', networkId: 'preview',
    campaignId: native.campaignId, contractAddress: native.contractAddress, recipientKey: native.recipientKey,
    receiptId, commitment: hex(native.state().receipts.lookup(bytes(receiptId))) };
  const packet = await createDisclosure({ receipt, taxpayerId, amount: 75, validFrom: time, validUntil: time + 1200, donorSecret, receiptSalt });
  const verificationKeys = [['mint', Uint8Array.of(1)], ['donate', Uint8Array.of(2)]];
  const shape = (data, locked) => ({ data: data.data ?? data,
    operations: () => ['mint', 'donate'], operation: name => ({ verifierKey: verificationKeys.find(([id]) => id === name)?.[1] }),
    maintenanceAuthority: { committee: locked ? [] : ['example-deployment-public-key'], threshold: 1, counter: locked ? 1n : 0n } });
  const initial = shape(native.initial.currentContractState, false), current = shape(result.context.currentQueryContext.state, true);
  const requests = [];
  const providers = { networkId: 'preview', publicDataProvider: {
    async queryContractState(address) { requests.push(address); return current; },
    async queryDeployContractState(address) { requests.push(address); return initial; },
  }, zkConfigProvider: { async getVerifierKeys(ids) { assert.deepEqual(ids, ['mint', 'donate']); return verificationKeys; } } };
  return { packet, current, initial, providers, requests };
}

test('authority checks opening, current code, empty deployment and one-way lock without sending private fields', async () => {
  const f = await fixture(); const result = await verifyIndexedDisclosure(f.packet, f.providers);
  assert.equal(result.valid, true); assert.equal(result.included, true); assert.equal(result.indexedDonationMatched, true);
  assert.equal(result.taxAccepted, false); assert.equal(result.independentlyVerified, false);
  assert.deepEqual(f.requests, [f.packet.receipt.contractAddress, f.packet.receipt.contractAddress]);
  assert.equal(f.requests.join('').includes(f.packet.donorSecret), false);
  assert.equal(result.disclosed.taxpayerId, 'Example claimant');
});
test('edited amount or taxpayer label cannot reuse a receipt; no indexer query is made', async () => {
  const f = await fixture();
  for (const change of [{ amount: 76 }, { taxpayerId: 'Another claimant' }, { donorSecret: randomHex32() }]) {
    const result = await verifyIndexedDisclosure({ ...f.packet, ...change }, f.providers);
    assert.equal(result.valid, false);
  }
  assert.equal(f.requests.length, 0);
});
test('authority rejects mutable contracts and upgrade history', async () => {
  const f = await fixture(); f.current.maintenanceAuthority.committee = ['upgrade-owner'];
  await assert.rejects(verifyIndexedDisclosure(f.packet, f.providers), /locked/);
  f.current.maintenanceAuthority.committee = []; f.current.maintenanceAuthority.counter = 2n;
  await assert.rejects(verifyIndexedDisclosure(f.packet, f.providers), /history/);
});
test('authority rejects additional circuits and fabricated initial receipts', async () => {
  const f = await fixture(); f.current.operations = () => ['mint', 'donate', 'forgeReceipt'];
  await assert.rejects(verifyIndexedDisclosure(f.packet, f.providers), /unexpected operations/);
  f.current.operations = () => ['mint', 'donate']; f.initial.data = f.current.data;
  await assert.rejects(verifyIndexedDisclosure(f.packet, f.providers), /deployment or upgrade history/);
});
test('authority rejects verifier keys inconsistent with the application', async () => {
  const f = await fixture(); f.current.operation = () => ({ verifierKey: Uint8Array.of(99) });
  await assert.rejects(verifyIndexedDisclosure(f.packet, f.providers));
});
test('mainnet and foreign campaign files cannot initialize a client', () => {
  const record = { version: 1, kind: 'donation-campaign', networkId: 'preview', contractAddress: randomHex32(), campaignId: randomHex32(), recipientKey: randomHex32(), recipientEncryptionKey: randomHex32(), recipientLabel: 'Community kitchen' };
  assert.deepEqual(validateJoinFile(record), record);
  assert.throws(() => validateJoinFile({ ...record, networkId: 'mainnet' }));
  assert.throws(() => validateJoinFile({ ...record, donorSecret: randomHex32() }));
  setNetworkId('preview');
  assert.throws(() => createNetworkClient({}, { networkId: 'mainnet', compiledAssetsPath: './network-contract' }));
  assert.throws(() => createNetworkClient({}, { networkId: 'preview', compiledAssetsPath: './network-contract' }), /Missing provider/);
});

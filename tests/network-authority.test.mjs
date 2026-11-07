import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeHarness, randomHex32, bytes, hex, taxpayerDigestFor, createDisclosure } from '../lib/native-engine.mjs';
import { verifyIndexedDisclosure, validateJoinFile, createNetworkClient } from '../lib/network/sdk-client.mjs';
import { readFile } from 'node:fs/promises';
import { ContractState, ContractOperation, ContractMaintenanceAuthority, sampleSigningKey, signatureVerifyingKey } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import { SerializedContractState } from '@midnight-ntwrk/midnight-js-types';

// Generated Compact execution with a deliberately synthetic indexer wrapper.
// These are verifier-boundary tests, not proof generation or chain settlement.
async function fixture() {
  const time = 1800000000;
  const native = await createNativeHarness({ now: time });
  const donorSecret = randomHex32(), receiptSalt = randomHex32(), receiptId = randomHex32();
  const taxpayerId = 'Example claimant', digest = await taxpayerDigestFor(taxpayerId);
  const coin = { nonce: bytes(randomHex32()), color: native.pure.testTokenColor(bytes(native.contractAddress)), value: 75n };
  const result = await native.call('donate', [coin, bytes(receiptId), BigInt(time), BigInt(time + 1200)],
    { donorSecret: bytes(donorSecret), receiptSalt: bytes(receiptSalt), taxpayerDigest: bytes(digest) });
  const receipt = { version: 1, kind: 'donation-public-receipt', mode: 'network', networkId: 'preview',
    campaignId: native.campaignId, contractAddress: native.contractAddress, recipientKey: native.recipientKey,
    receiptId, commitment: hex(native.state().receipts.lookup(bytes(receiptId))) };
  const packet = await createDisclosure({ receipt, taxpayerId, amount: 75, validFrom: time, validUntil: time + 1200, donorSecret, receiptSalt });
  const verificationKeys = await Promise.all(['mint', 'donate'].map(async name => [name,
    new Uint8Array(await readFile(new URL(`../contracts/managed/donations/keys/${name}.verifier`, import.meta.url)))]));
  const deploymentPublicKey = signatureVerifyingKey(sampleSigningKey());
  const operation = key => { const value = new ContractOperation(); value.verifierKey = key; return value; };
  const shape = (data, locked) => {
    const value = new ContractState(); value.data = data.data ?? data;
    for (const [name, key] of verificationKeys) value.setOperation(name, operation(key));
    value.maintenanceAuthority = new ContractMaintenanceAuthority(locked ? [] : [deploymentPublicKey], 1, locked ? 1n : 0n);
    return value;
  };
  const initial = shape(native.initial.currentContractState, false), current = shape(result.context.callContext.currentQueryContext.state, true);
  const serialized = value => ({ protocolVersion: 2_000_000, contractState: SerializedContractState.fromBytes('v9', value.serialize()) });
  const requests = [];
  const providers = { networkId: 'preview', publicDataProvider: {
    async queryContractState(address) { requests.push(address); return serialized(current); },
    async queryDeployContractState(address) { requests.push(address); return serialized(initial); },
  }, zkConfigProvider: { async getVerifierKeys(ids) { assert.deepEqual(ids, ['mint', 'donate']); return verificationKeys; } } };
  return { packet, current, initial, providers, requests, deploymentPublicKey, verificationKeys, operation };
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
  const f = await fixture(); f.current.maintenanceAuthority = new ContractMaintenanceAuthority([f.deploymentPublicKey], 1, 1n);
  await assert.rejects(verifyIndexedDisclosure(f.packet, f.providers), /locked/);
  f.current.maintenanceAuthority = new ContractMaintenanceAuthority([], 1, 2n);
  await assert.rejects(verifyIndexedDisclosure(f.packet, f.providers), /history/);
});
test('authority rejects additional circuits and fabricated initial receipts', async () => {
  const f = await fixture(); f.current.setOperation('forgeReceipt', f.operation(f.verificationKeys[0][1]));
  await assert.rejects(verifyIndexedDisclosure(f.packet, f.providers), /unexpected operations/);
  const forged = await fixture(); forged.initial.data = forged.current.data;
  await assert.rejects(verifyIndexedDisclosure(forged.packet, forged.providers), /deployment or upgrade history/);
});
test('authority rejects verifier keys inconsistent with the application', async () => {
  const f = await fixture(); f.current.setOperation('mint', f.operation(f.verificationKeys[1][1]));
  await assert.rejects(verifyIndexedDisclosure(f.packet, f.providers));
});
test('mainnet and foreign campaign files cannot initialize a client', () => {
  const record = { version: 1, kind: 'donation-campaign', networkId: 'preview', contractAddress: randomHex32(), campaignId: randomHex32(), recipientKey: randomHex32(), recipientEncryptionKey: randomHex32(), recipientLabel: 'Community kitchen' };
  assert.deepEqual(validateJoinFile(record), record);
  assert.throws(() => validateJoinFile({ ...record, networkId: 'mainnet' }));
  assert.throws(() => validateJoinFile({ ...record, donorSecret: randomHex32() }));
  assert.throws(() => createNetworkClient({}, { networkId: 'mainnet', compiledAssetsPath: './network-contract' }));
  assert.throws(() => createNetworkClient({}, { networkId: 'preview', compiledAssetsPath: './network-contract' }), /Missing provider/);
});

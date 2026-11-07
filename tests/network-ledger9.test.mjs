import test from 'node:test';
import assert from 'node:assert/strict';
import { LedgerTransaction, SerializedContractState } from '@midnight-ntwrk/midnight-js-types';
import { loadLedger8Protocol } from '@midnight-ntwrk/midnight-js-protocol';
import { Transaction } from '@midnight-ntwrk/midnight-js-protocol/v9';
import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import { createProviderConfig, requireProviderConfig, decodeDonationContractRead, requireLedger9Transaction } from '../lib/network/ledger9.mjs';

test('each provider set pins its network and bounded TTL without shared global state', () => {
  const preview = createProviderConfig('preview'), local = createProviderConfig('undeployed');
  assert.equal(preview.networkId, 'preview'); assert.equal(local.networkId, 'undeployed');
  assert.equal(preview.ttlSeconds, 1800); assert.equal(Object.isFrozen(preview), true);
  assert.throws(() => requireProviderConfig(local, 'preview'));
  for (const ttlSeconds of [0, -1, 1.5, 3601, Infinity, '1800']) assert.throws(() => requireProviderConfig({ networkId: 'preview', ttlSeconds }, 'preview'));
  assert.throws(() => createProviderConfig('mainnet'));
});

test('current ledger reads are decoded by the application runtime; retired-era and untagged reads are refused', async () => {
  const state = new ContractState();
  const read = { protocolVersion: 2_000_000, contractState: SerializedContractState.fromBytes('v9', state.serialize()) };
  assert.ok(decodeDonationContractRead(read) instanceof ContractState);
  assert.throws(() => decodeDonationContractRead(state));
  assert.throws(() => decodeDonationContractRead({ ...read, protocolVersion: 1_000_000 }));
  const legacy = await loadLedger8Protocol();
  const old = new legacy.ContractState();
  assert.throws(() => decodeDonationContractRead({ protocolVersion: 2_000_000,
    contractState: SerializedContractState.fromBytes('v8', old.serialize()) }));
});

test('wrong-stage and ledger8 handles cannot reach wallet proving or submission', async () => {
  const current = LedgerTransaction.seal('v9', 'Unproven', Transaction.fromParts('preview'));
  assert.equal(requireLedger9Transaction(current, 'Unproven'), current);
  assert.throws(() => requireLedger9Transaction(current, 'Finalized'));
  assert.throws(() => requireLedger9Transaction({ era: 'v9', stage: 'Unproven', serialize() {} }, 'Unproven'));
  const legacy = await loadLedger8Protocol();
  const old = LedgerTransaction.seal('v8', 'Unproven', legacy.Transaction.fromParts('preview'));
  assert.throws(() => requireLedger9Transaction(old, 'Unproven'));
});

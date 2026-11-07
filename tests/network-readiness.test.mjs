import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNativeTransactionReady, nativeTransactionReadinessMessage } from '../lib/network/wallet-readiness.mjs';
import { nativeNetworkErrorMessage } from '../lib/network/config.mjs';

test('readiness distinguishes unregistered NIGHT from zero accrued DUST without a transaction', async () => {
  for (const [cap, expected] of [[0n, /Generate tDUST/], [20n, /zero usable DUST/]]) {
    const stages = [];
    const api = { getDustBalance: async () => ({ cap, balance: 0n }) };
    await assert.rejects(assertNativeTransactionReady(api, async () => {}, stage => stages.push(stage)), error => {
      assert.match(nativeTransactionReadinessMessage(error), expected);
      return true;
    });
    assert.deepEqual(stages, ['wallet-session-check', 'wallet-dust-check']);
  }
});

test('positive DUST is only a prerequisite and does not attest sync or fee coverage', async () => {
  const stages = [];
  const result = await assertNativeTransactionReady({ getDustBalance: async () => ({ cap: 30n, balance: 2n }) },
    async () => {}, stage => stages.push(stage));
  assert.deepEqual(result, { dustReportedPositive: true, feeCoverageVerified: false, synchronizationVerified: false });
  assert.deepEqual(stages, ['wallet-session-check', 'wallet-dust-check', 'wallet-dust-ready']);
});

test('read-only deadlines stop readiness without dispatching a wallet transaction', async () => {
  let balanceReads = 0;
  await assert.rejects(assertNativeTransactionReady({ getDustBalance() { balanceReads++; } }, () => new Promise(() => {}),
    () => {}, { timeoutMs: 5 }), error => /connection check/.test(nativeTransactionReadinessMessage(error)));
  assert.equal(balanceReads, 0);
  await assert.rejects(assertNativeTransactionReady({ getDustBalance: () => new Promise(() => {}) }, async () => {},
    () => {}, { timeoutMs: 5 }), error => /DUST balance check/.test(nativeTransactionReadinessMessage(error)));
});

test('missing, malformed and failing wallet balance reads produce fixed safe messages', async () => {
  for (const api of [
    {}, { getDustBalance: async () => ({ cap: '3', balance: '1' }) },
    { getDustBalance: async () => ({ cap: 1n, balance: -1n }) },
    { getDustBalance: async () => { throw new Error('private-wallet-payload'); } },
  ]) {
    await assert.rejects(assertNativeTransactionReady(api, async () => {}), error => {
      const safe = nativeTransactionReadinessMessage(error);
      assert.equal(typeof safe, 'string'); assert.equal(safe.includes('private-wallet-payload'), false); return true;
    });
  }
});

test('documented connector failures have specific safe feedback without exposing reason or cause', async () => {
  const expected = { Rejected: /rejected/, PermissionRejected: /permission/, Disconnected: /disconnected/,
    InsufficientFunds: /insufficient funds/, InvalidRequest: /unsupported or invalid/, InternalError: /could not process/ };
  for (const [code, pattern] of Object.entries(expected)) {
    const raw = { type: 'DAppConnectorAPIError', code, reason: 'private-opening', message: 'private-opening', cause: 'private-opening' };
    const safe = nativeNetworkErrorMessage(raw);
    assert.match(safe, pattern); assert.equal(safe.includes('private-opening'), false);
    await assert.rejects(assertNativeTransactionReady({ getDustBalance: async () => { throw raw; } }, async () => {}), error => error === raw);
  }
  assert.doesNotThrow(() => nativeNetworkErrorMessage({ get type() { throw new Error('private-opening'); } }));
});

test('SDK preparation, provider and confirmation failures keep their useful category without private payloads', () => {
  const cases = [
    ['MIDNIGHT_JS_U_ZK_ARTIFACT_INTEGRITY_FAILED', /compiler manifest/],
    ['MIDNIGHT_JS_PR_ZK_ARTIFACT_FETCH_FAILED', /download/],
    ['MIDNIGHT_JS_PR_PRIVATE_STATE_DECRYPTION_FAILED', /original app-storage password/],
    ['MIDNIGHT_JS_C_ERA_MISMATCH', /ledger version/],
    ['MIDNIGHT_JS_PR_INDEXER_QUERY_FAILED', /indexer/],
    ['MIDNIGHT_JS_PR_WATCH_TIMED_OUT', /may already have been submitted/],
    ['MIDNIGHT_JS_C_TX_FAILED', /part of a transaction/],
  ];
  for (const [code, expected] of cases) {
    const safe = nativeNetworkErrorMessage({ code, message: 'secret-signing-key', reason: 'secret-signing-key', cause: { message: 'secret-signing-key' } });
    assert.match(safe, expected); assert.equal(safe.includes('secret-signing-key'), false);
  }
  for (const [method, expected] of [['proveTx', /proof provider/], ['balanceTx', /balance or approve/], ['submitTx', /may already have reached/]]) {
    const safe = nativeNetworkErrorMessage({ code: 'MIDNIGHT_JS_C_PROVIDER_FAILED', method, circuitId: 'secret-receipt', cause: 'secret-receipt' });
    assert.match(safe, expected); assert.equal(safe.includes('secret-receipt'), false);
  }
  assert.doesNotThrow(() => nativeNetworkErrorMessage({ get code() { throw new Error('secret-signing-key'); } }));
});

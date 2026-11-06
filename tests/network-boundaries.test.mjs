import test from 'node:test';
import assert from 'node:assert/strict';
import { NETWORK_DEFAULTS, resolveNativeBrowserConfig, requireDevelopmentNetwork, requireConnectedNetwork, requireLaceInternalProving, findNativeWallets, nativeNetworkErrorMessage } from '../lib/network/config.mjs';
import { nativeConnectionFailure, nativeConnectionErrorMessage } from '../lib/network/connection-errors.mjs';
import { checkPreviewPublicServices, formatPreviewServiceError } from '../lib/network/public-testnet.mjs';

const page = 'https://ibkr-bouncybot.github.io/Midnight-Private-but-tax-compliant-donations/network.html';
test('Preview proving assets retain the actual GitHub project path', () => {
  const config = resolveNativeBrowserConfig(NETWORK_DEFAULTS.preview, `${page}#setup`);
  assert.equal(config.compiledAssetsUrl, 'https://ibkr-bouncybot.github.io/Midnight-Private-but-tax-compliant-donations/network-contract');
  assert.equal(config.networkId, 'preview');
});
test('mainnet, cross-network endpoints and foreign proof material fail closed', () => {
  assert.throws(() => requireDevelopmentNetwork('mainnet'));
  assert.throws(() => resolveNativeBrowserConfig({ ...NETWORK_DEFAULTS.preview, indexerUri: 'https://indexer.mainnet.midnight.network/api/v4/graphql' }, page));
  assert.throws(() => resolveNativeBrowserConfig({ ...NETWORK_DEFAULTS.preview, compiledAssetsUrl: 'https://other.example/material' }, page));
  assert.throws(() => resolveNativeBrowserConfig({ ...NETWORK_DEFAULTS.preview, indexerUri: 'http://remote.example/' }, page));
});
test('internal Lace proving requires an explicit confirmation and refuses reported proof servers', () => {
  const wallet = { rdns: 'io.lace.wallet', apiVersion: '4.0.1' };
  assert.equal(requireLaceInternalProving(wallet, true, {}), 'lace-internal-wasm-user-confirmed');
  for (const value of [false, undefined, 1, 'true']) assert.throws(() => requireLaceInternalProving(wallet, value, {}));
  for (const value of ['http://localhost:6300', 'https://remote.example/', '', null, 42]) assert.throws(() => requireLaceInternalProving(wallet, true, { proverServerUri: value }));
  assert.throws(() => requireLaceInternalProving({ ...wallet, apiVersion: '3.0.0' }, true, {}));
});
test('wallet account must stay connected on the selected network', () => {
  assert.doesNotThrow(() => requireConnectedNetwork({ status: 'connected', networkId: 'preview' }, { networkId: 'preview' }, 'preview'));
  assert.throws(() => requireConnectedNetwork({ status: 'disconnected', networkId: 'preview' }, { networkId: 'preview' }, 'preview'));
  assert.throws(() => requireConnectedNetwork({ status: 'connected', networkId: 'preprod' }, { networkId: 'preview' }, 'preview'));
});
test('discovery does not mistake a Cardano or older connector for Midnight API 4', () => {
  const lace = { name: 'Lace', rdns: 'io.lace.wallet', apiVersion: '4.0.1', connect() {} };
  assert.deepEqual(findNativeWallets({ lace, old: { ...lace, apiVersion: '3.0.0' }, cardano: { enable() {} } }).map(w => w.id), ['lace']);
});
test('wallet and connection failures never surface arbitrary private payloads', () => {
  const raw = new Error('secret-taxpayer-opening');
  assert.equal(nativeNetworkErrorMessage(raw).includes(raw.message), false);
  const fixed = nativeConnectionFailure('connection-account', raw);
  assert.equal(nativeConnectionErrorMessage(fixed).includes(raw.message), false);
  assert.equal(nativeConnectionErrorMessage(raw), null);
});
test('Preview connectivity checks send only public service queries and reject wrong-chain responses', async () => {
  const requests = [];
  const result = await checkPreviewPublicServices({ fetchImpl: async (url, init) => {
    requests.push(JSON.parse(init.body));
    return { ok: true, json: async () => url.includes('rpc.') ? { jsonrpc: '2.0', id: 1, result: 'Midnight Preview' } : { data: { block: { height: 120 } } } };
  } });
  assert.equal(result.blockHeight, 120);
  assert.equal(result.transactionSubmitted, false);
  assert.equal(result.walletConnected, false);
  assert.deepEqual(requests, [{ jsonrpc: '2.0', id: 1, method: 'system_chain', params: [] }, { query: '{ block { height } }' }]);
  await assert.rejects(checkPreviewPublicServices({ fetchImpl: async () => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: 'Midnight Mainnet' }) }) }), error => typeof formatPreviewServiceError(error) === 'string');
});

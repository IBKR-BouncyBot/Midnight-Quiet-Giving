import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createDonationZkConfigProvider } from '../lib/network/artifact-provider.mjs';

const base = 'https://example.test/app/network-contract';
const assetRoot = new URL('../contracts/managed/donations/', import.meta.url);
const manifest = await readFile(new URL('compiler/contract-manifest.json', assetRoot));
const expectedManifestHash = createHash('sha256').update(manifest).digest('hex');

function provider({ damageKey = false, damageManifest = false } = {}) {
  const requests = [];
  const zk = createDonationZkConfigProvider(base, { expectedManifestHash, fetchImpl: async (url, options) => {
    requests.push({ url, options });
    const relative = url.slice(base.length + 1);
    assert.ok(['compiler/contract-manifest.json', 'keys/mint.verifier', 'compiler/contract-info.json'].includes(relative));
    let bytes = new Uint8Array(await readFile(new URL(relative, assetRoot)));
    if (damageKey && relative === 'keys/mint.verifier') { bytes = bytes.slice(); bytes[bytes.length - 1] ^= 1; }
    if (damageManifest && relative === 'compiler/contract-manifest.json') bytes = new TextEncoder().encode(new TextDecoder().decode(bytes) + ' ');
    return new Response(bytes, { status: 200, headers: { 'content-type': relative.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
  } });
  return { zk, requests };
}

test('served compiler manifest is pinned and authentic verifier assets are checked by SDK5', async () => {
  const { zk, requests } = provider();
  assert.equal(await zk.getArtifactRuntimeVersion(), '0.21.0');
  assert.deepEqual(await zk.getVerifierKey('mint'), new Uint8Array(await readFile(new URL('keys/mint.verifier', assetRoot))));
  assert.ok(requests.every(({ url, options }) => url.startsWith(`${base}/`) && options.redirect === 'error' && options.credentials === 'same-origin'));
});

test('modified verifier bytes and substituted manifest are refused before proving', async () => {
  await assert.rejects(provider({ damageKey: true }).zk.getVerifierKey('mint'));
  await assert.rejects(provider({ damageManifest: true }).zk.getVerifierKey('mint'));
});

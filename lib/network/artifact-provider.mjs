import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';

// The browser build supplies the hash of its reviewed compiler manifest.
// Node source imports have no build-time define, while still requiring a
// manifest and verifying every artifact against it.
const buildManifestHash = typeof __QUIET_GIVING_MANIFEST_SHA256__ === 'string' ? __QUIET_GIVING_MANIFEST_SHA256__ : undefined;

export function createDonationZkConfigProvider(baseURL, { fetchImpl = globalThis.fetch, expectedManifestHash = buildManifestHash } = {}) {
  const base = new URL(baseURL);
  const fetchFunc = (url, init) => {
    const target = new URL(url);
    if (target.origin !== base.origin || !target.pathname.startsWith(`${base.pathname.replace(/\/$/, '')}/`)) {
      throw new Error('Compiled asset request escaped the selected asset directory');
    }
    return fetchImpl(target.href, { ...init, redirect: 'error', credentials: 'same-origin' });
  };
  return new FetchZkConfigProvider(base.href, { fetchFunc, verify: 'require', expectedManifestHash });
}

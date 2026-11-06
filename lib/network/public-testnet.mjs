// Adapted from Midnight BallotLab by IBKR-BouncyBot (PolyForm Noncommercial).
/** Public Preview configuration and read-only service checks.
 * These requests contain no wallet/account data, witnesses or transactions.
 * A successful check is connectivity evidence, not authenticated chain state.
 */
export const PREVIEW_PUBLIC_SERVICES = Object.freeze({
  networkId: 'preview',
  nodeRpc: 'https://rpc.preview.midnight.network',
  indexerUri: 'https://indexer.preview.midnight.network/api/v4/graphql',
  indexerWsUri: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
  faucetUrl: 'https://midnight-tmnight-preview.nethermind.dev/',
  guideUrl: 'https://docs.midnight.network/guides/networks-and-environments',
});

export function previewBrowserConfiguration({ compiledAssetsUrl = './network-contract' } = {}) {
  if (typeof compiledAssetsUrl !== 'string' || !compiledAssetsUrl.trim()) {
    throw new TypeError('A compiled asset location is required');
  }
  // The existing browser configuration boundary enforces same-origin assets.
  return Object.freeze({ networkId: PREVIEW_PUBLIC_SERVICES.networkId,
    indexerUri: PREVIEW_PUBLIC_SERVICES.indexerUri, indexerWsUri: PREVIEW_PUBLIC_SERVICES.indexerWsUri,
    compiledAssetsUrl });
}

// Only errors created here may supply UI diagnostics. Do not trust error.name,
// message, code or cause from fetch, a wallet, or an arbitrary caller object.
const safeErrorMessages = new WeakMap();
const serviceNames = Object.freeze({ node: 'public Preview node', indexer: 'public Preview indexer', services: 'public Preview node and indexer' });
class PreviewServiceCheckError extends Error {
  constructor(code, service, explanation, httpStatus) {
    const message = `${explanation} This check did not connect a wallet or submit a transaction.`;
    super(message); this.name = 'PreviewServiceCheckError';
    Object.defineProperties(this, {
      code: { value: code, enumerable: true }, service: { value: service, enumerable: true },
      ...(httpStatus === undefined ? {} : { httpStatus: { value: httpStatus, enumerable: true } }),
    });
    safeErrorMessages.set(this, message);
  }
}
/** A known, fixed safe UI message, or null for every unbranded error/object. */
export function formatPreviewServiceError(error) {
  return safeErrorMessages.get(error) ?? null;
}
const unavailable = () => new PreviewServiceCheckError('service-unavailable', 'services', 'The public Preview service check could not start. Try reloading this page.');

export async function checkPreviewPublicServices({ fetchImpl = globalThis.fetch, signal } = {}) {
  if (typeof fetchImpl !== 'function') throw unavailable();
  if (signal != null && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw unavailable();
  const controller = new AbortController();
  let timedOut = false, rejectStopped;
  const pending = new Set(['node', 'indexer']);
  const cancelled = () => controller.abort();
  const stopped = new Promise((_, reject) => { rejectStopped = reject; });
  const onStop = () => {
    const service = pending.size === 1 ? [...pending][0] : 'services';
    rejectStopped(new PreviewServiceCheckError(timedOut ? 'timeout' : 'cancelled', service, timedOut
      ? `The ${serviceNames[service]} did not finish responding within 15 seconds. Check your connection or try again.`
      : `The ${serviceNames[service]} check was cancelled. You can start a new check.`));
  };
  controller.signal.addEventListener('abort', onStop, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', cancelled, { once: true });
  async function request(service, url, body) {
    if (controller.signal.aborted) return stopped;
    let response;
    try {
      response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal, credentials: 'omit', redirect: 'error',
        cache: 'no-store', referrerPolicy: 'no-referrer' });
    } catch {
      if (controller.signal.aborted) return stopped;
      // Browser fetch does not reliably distinguish CORS, DNS, TLS, an offline
      // device or a blocked connection. Describe possibilities without guessing.
      throw new PreviewServiceCheckError('transport-unavailable', service,
        `Your browser could not reach the ${serviceNames[service]}. Check your connection and browser or network restrictions; the service may also be temporarily unavailable.`);
    }
    if (!response?.ok) {
      const status = Number.isInteger(response?.status) && response.status >= 100 && response.status <= 599 ? response.status : undefined;
      throw new PreviewServiceCheckError('http-status', service, status === undefined
        ? `The ${serviceNames[service]} returned an unusable HTTP response. Try again shortly.`
        : `The ${serviceNames[service]} returned HTTP ${status}. ${status === 429 ? 'Its request limit was reached; wait before trying again.' : 'Try again shortly.'}`, status);
    }
    try { return await response.json(); }
    catch {
      if (controller.signal.aborted) return stopped;
      throw new PreviewServiceCheckError('invalid-json', service,
        `The ${serviceNames[service]} returned a response that could not be read as JSON. Try again shortly.`);
    }
  }
  try {
    const checks = Promise.all([
      request('node', PREVIEW_PUBLIC_SERVICES.nodeRpc, { jsonrpc: '2.0', id: 1, method: 'system_chain', params: [] }).then(value => {
        if (value?.jsonrpc !== '2.0' || value.id !== 1 || value.error !== undefined || value.result !== 'Midnight Preview') {
          throw new PreviewServiceCheckError('network-identity', 'node', 'The public node did not identify itself as Midnight Preview. Do not submit a transaction.');
        }
        pending.delete('node');
        return value.result;
      }),
      request('indexer', PREVIEW_PUBLIC_SERVICES.indexerUri, { query: '{ block { height } }' }).then(value => {
        const height = value?.data?.block?.height;
        if ((value?.errors != null && (!Array.isArray(value.errors) || value.errors.length !== 0))
            || !Number.isSafeInteger(height) || height < 0) {
          throw new PreviewServiceCheckError('indexer-response', 'indexer', 'The public Preview indexer did not return a valid block height. Try again shortly.');
        }
        pending.delete('indexer');
        return height;
      }),
    ]);
    const [chainName, blockHeight] = await Promise.race([checks, stopped]);
    return Object.freeze({ networkId: 'preview', chainName, blockHeight, source: 'fixed-public-preview-services',
      walletConnected: false, proofGenerated: false, transactionSubmitted: false });
  } catch (error) {
    // Transport/JSON/SDK exceptions can include URLs, request bodies or secrets.
    // Keep only our fixed messages and codes; never attach a raw cause.
    if (safeErrorMessages.has(error)) throw error;
    throw unavailable();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancelled);
    controller.signal.removeEventListener('abort', onStop);
    controller.abort();
  }
}

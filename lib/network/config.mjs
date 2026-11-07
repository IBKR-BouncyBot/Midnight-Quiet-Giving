/** Adapted from Midnight BallotLab by IBKR-BouncyBot (PolyForm Noncommercial).
 * Public configuration boundaries for the development/test network client.
 * These functions perform no cryptography, wallet connection, or network call.
 */
const DEVELOPMENT_NETWORKS = new Set(['undeployed', 'preview', 'preprod']);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export const NETWORK_DEFAULTS = Object.freeze({
  preview: Object.freeze({ networkId: 'preview', indexerUri: 'https://indexer.preview.midnight.network/api/v4/graphql', indexerWsUri: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws', compiledAssetsUrl: './network-contract' }),
  undeployed: Object.freeze({ networkId: 'undeployed', indexerUri: 'http://127.0.0.1:28088/api/v4/graphql', indexerWsUri: 'ws://127.0.0.1:28088/api/v4/graphql/ws', compiledAssetsUrl: './network-contract' }),
});

/** Explicit read-only check; no wallet information or transaction is sent. */
export async function checkPublicServices(configuration, {pageUrl=globalThis.location?.href, fetchImpl=globalThis.fetch}={}) {
  const config=resolveNativeBrowserConfig(configuration,pageUrl);
  if(config.networkId==='preview'&&config.indexerUri===NETWORK_DEFAULTS.preview.indexerUri){
    const {checkPreviewPublicServices}=await import('./public-testnet.mjs');
    return checkPreviewPublicServices({fetchImpl});
  }
  try{
    const response=await fetchImpl(config.indexerUri,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'{ block { height } }'}),credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('unavailable');const value=await response.json();
    if(value.errors||!Number.isSafeInteger(value.data?.block?.height)||value.data.block.height<0)throw new Error('invalid');
    return {networkId:config.networkId,blockHeight:value.data.block.height,source:'configured-indexer',walletConnected:false,proofGenerated:false,transactionSubmitted:false,networkIdentityAuthenticated:false};
  }catch{throw new Error('The configured indexer check did not finish successfully. No wallet was connected and no transaction was submitted.');}
}

function requireMatchingKnownNetwork(url, networkId) {
  // Recognize official and Blockfrost service names without claiming that an
  // arbitrary custom endpoint has been authenticated. Never include its URL
  // in errors: a user's query string may contain an access token.
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const official = host.match(/^(?:indexer|rpc)\.(preview|preprod|mainnet)\.midnight\.network$/);
  const blockfrost = host.match(/^(?:rpc\.)?midnight-(preview|preprod|mainnet)\.blockfrost\.io$/);
  const knownNetwork = official?.[1] ?? blockfrost?.[1];
  if (knownNetwork && knownNetwork !== networkId) {
    throw new TypeError('A known public service belongs to a different network; choose matching development endpoints');
  }
}

export function requireDevelopmentNetwork(networkId) {
  if (!DEVELOPMENT_NETWORKS.has(networkId)) {
    throw new TypeError('Choose an explicit development network: undeployed, preview or preprod');
  }
  return networkId;
}

export function findNativeWallets(registry = globalThis.midnight) {
  if (!registry || typeof registry !== 'object') return [];
  // Connector IDs change after reload. Keep all compatible entries so the UI
  // can ask the user which one to connect, including duplicate rdns claims.
  return Object.entries(registry)
    .filter(([, wallet]) => wallet && typeof wallet.connect === 'function'
      && typeof wallet.apiVersion === 'string' && /^4\.\d+\.\d+(?:[-+].*)?$/.test(wallet.apiVersion)
      && typeof wallet.rdns === 'string' && typeof wallet.name === 'string')
    .map(([id, wallet]) => ({ id, name: wallet.name, rdns: wallet.rdns, apiVersion: wallet.apiVersion, wallet }));
}

function serviceUrl(value, protocols, name) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`${name} must be an absolute URL`); }
  if (!protocols.includes(url.protocol) || url.username || url.password || url.hash) {
    throw new TypeError(`${name} has an unsupported protocol, credentials or fragment`);
  }
  if ((url.protocol === 'http:' || url.protocol === 'ws:') && !LOOPBACK.has(url.hostname)) {
    throw new TypeError(`${name} requires a secure connection except on loopback`);
  }
  return url;
}

export function resolveNativeBrowserConfig({ networkId, indexerUri, indexerWsUri, compiledAssetsUrl }, pageUrl) {
  requireDevelopmentNetwork(networkId);
  let pageLocation;
  try { pageLocation = new URL(pageUrl); } catch { throw new TypeError('Page URL must be an absolute URL'); }
  // The application uses fragments for step navigation. They are not endpoint
  // configuration and must not prevent connecting a wallet on those steps.
  pageLocation.hash = '';
  const page = serviceUrl(pageLocation.href, ['http:', 'https:'], 'Page URL');
  const indexer = serviceUrl(indexerUri, ['http:', 'https:'], 'Indexer URL');
  const websocket = serviceUrl(indexerWsUri, ['ws:', 'wss:'], 'Indexer WebSocket URL');
  requireMatchingKnownNetwork(indexer, networkId);
  requireMatchingKnownNetwork(websocket, networkId);
  if ((indexer.protocol === 'http:' && indexer.hostname === '[::1]')
    || (websocket.protocol === 'ws:' && websocket.hostname === '[::1]')) {
    throw new TypeError('Use localhost or 127.0.0.1 for insecure loopback indexer endpoints; browser CSP does not accept IPv6 host sources');
  }
  if (typeof compiledAssetsUrl !== 'string' || !compiledAssetsUrl) throw new TypeError('compiledAssetsUrl is required');
  const assets = serviceUrl(new URL(compiledAssetsUrl, page).href, ['http:', 'https:'], 'Compiled asset URL');
  if (assets.origin !== page.origin || assets.search) throw new TypeError('Compiled assets must be served from this page origin without a query');
  // FetchZkConfigProvider appends /keys and /zkir. Relative resolution retains
  // a GitHub project path such as /midnight-ballot-lab/native-contract.
  return Object.freeze({
    networkId,
    indexerUri: indexer.href,
    indexerWsUri: websocket.href,
    compiledAssetsUrl: assets.href.replace(/\/+$/, ''),
  });
}

export function requireConnectedNetwork(status, configuration, networkId) {
  requireDevelopmentNetwork(networkId);
  if (status?.status !== 'connected' || status.networkId !== networkId || configuration?.networkId !== networkId) {
    throw new Error('Wallet connection or configuration does not match the selected development network');
  }
  for (const field of ['indexerUri', 'indexerWsUri', 'substrateNodeUri']) {
    if (configuration[field] === undefined) continue;
    let url;
    try { url = new URL(configuration[field]); }
    catch { throw new TypeError('The wallet reported an invalid service URL'); }
    requireMatchingKnownNetwork(url, networkId);
  }
}

export function requireLocalWalletProver(configuration) {
  // Isolated developer harness only. Public Preview uses Lace's internal mode.
  const prover = serviceUrl(configuration?.proverServerUri, ['http:', 'https:'], 'Wallet prover URL');
  if (!LOOPBACK.has(prover.hostname) || prover.search) {
    throw new Error('This prototype requires the wallet to report a local loopback prover');
  }
  return prover.href;
}

export function requireLaceInternalProving(wallet, confirmed, configuration = {}) {
  // API 4 has no proving-mode attestation or setter. Lace omits this URI for
  // BOTH in-process WASM and delegated TEE. Never call absence proof of WASM.
  // The session-only user selection is required in addition to this negative
  // URL check. Metadata identifies the selected connector, not its authenticity.
  if (wallet?.rdns !== 'io.lace.wallet' || !/^4\.\d+\.\d+(?:[-+].*)?$/.test(wallet?.apiVersion ?? '')) {
    throw new Error('Select the Lace API 4 connector for internal proving');
  }
  if (confirmed !== true) throw new Error('Confirm Run in this app (WASM) is selected in Lace');
  if (!configuration || typeof configuration !== 'object' || configuration.proverServerUri !== undefined) {
    throw new Error('Lace reports a proof-server configuration; select Run in this app (WASM)');
  }
  return 'lace-internal-wasm-user-confirmed';
}

export function nativeNetworkErrorMessage(error) {
  // Wallet/SDK errors can include serialized inputs and remote error bodies.
  // Never forward message, stack, cause or an arbitrary error object to UI logs.
  const connectorMessages = {
    Rejected: 'The wallet request was rejected. No automatic retry was made.',
    PermissionRejected: 'Lace denied permission for this action. Review its connected-app permissions and reconnect. No automatic retry was made.',
    Disconnected: 'Lace disconnected during this action. Unlock its Midnight account and reconnect. If a transaction was already approved, check its status before trying again.',
    InsufficientFunds: 'Lace reports insufficient funds for this transaction. Check usable test DUST for fees and, when donating, the required test-token balance. Holding tNIGHT alone does not pay the fee. No automatic retry was made.',
    InvalidRequest: 'Lace rejected the transaction request as unsupported or invalid. Check that Lace supports the current Preview ledger and that this page is up to date. No automatic retry was made.',
    InternalError: 'Lace could not process this request. Open its Midnight account and check synchronization and the internal WASM setting. If you already approved a transaction, check its status before trying again.',
  };
  // Exact public codes from the pinned Midnight.js 5 packages. Only these
  // discriminators and the provider's finite method name are inspected; SDK
  // errors can otherwise contain private state, transaction bytes or keys.
  const sdkMessages = {
    MIDNIGHT_JS_U_ZK_ARTIFACT_INTEGRITY_FAILED: 'The contract files did not match the app’s verified compiler manifest. Reload the page to get a consistent version. The integrity check was not bypassed.',
    MIDNIGHT_JS_U_ZK_ARTIFACT_CONTRACT_INFO_INVALID: 'The app could not read its compiled contract information. Reload the page; if this continues, the published contract files need repair.',
    MIDNIGHT_JS_PR_ARTIFACT_RUNTIME_VERSION_UNAVAILABLE: 'The app could not determine which Midnight runtime its contract files require. Reload the page; if this continues, the published contract files need repair.',
    MIDNIGHT_JS_PR_ZK_ARTIFACT_NOT_FOUND: 'A required contract file is missing. Reload the page; if this continues, the published contract files need repair.',
    MIDNIGHT_JS_PR_ZK_ARTIFACT_FETCH_FAILED: 'The app could not download a required contract file. Check your connection and reload the page before starting a new transaction.',
    MIDNIGHT_JS_PR_ZK_ARTIFACT_NOT_SERVED: 'The website did not serve a required contract file. Reload the page; if this continues, the published contract files need repair.',
    MIDNIGHT_JS_C_ERA_MISMATCH: 'The contract, wallet or network uses an incompatible Midnight ledger version. Use the current Quiet Giving page and a ledger 9-compatible Lace wallet on Preview.',
    MIDNIGHT_JS_PR_PROVIDER_ERA_UNSUPPORTED: 'A wallet or transaction provider does not support this Midnight ledger version. Use a ledger 9-compatible Lace wallet on Preview.',
    MIDNIGHT_JS_P_UNKNOWN_PROTOCOL_VERSION_READ: 'The Preview network reported a protocol version this app cannot read. Check that this page and Lace are up to date.',
    MIDNIGHT_JS_P_UNKNOWN_PROTOCOL_VERSION_CONSTRUCT: 'The Preview network reported a protocol version this app cannot transact on. Check that this page and Lace are up to date.',
    MIDNIGHT_JS_PR_INDEXER_GRAPHQL_FAILED: 'The Preview indexer rejected the app’s query. Contract preparation or confirmation could not finish. If you already approved a transaction, check its status before trying again.',
    MIDNIGHT_JS_PR_INDEXER_QUERY_FAILED: 'The Preview indexer could not answer the app’s query. Check the public network services. If you already approved a transaction, check its status before trying again.',
    MIDNIGHT_JS_C_NETWORK_VERSION_READ_FAILED: 'The Preview indexer could not confirm the network’s ledger version. Check the public network services before trying again.',
    MIDNIGHT_JS_PR_WATCH_TIMED_OUT: 'The Preview indexer did not confirm the transaction in time. It may already have been submitted. Check Lace’s transaction history and refresh contract state before trying again.',
    MIDNIGHT_JS_PR_PRIVATE_STATE_DECRYPTION_FAILED: 'The app could not unlock its encrypted storage. Reconnect with the original app-storage password, which is separate from your Lace password.',
    MIDNIGHT_JS_PR_PRIVATE_STATE_STORAGE_FAILED: 'The app could not save its encrypted keys or private state. Keep this tab open and check browser site-storage access. If a transaction was approved, check its status before trying again.',
    MIDNIGHT_JS_PR_PRIVATE_STATE_LIMIT_EXCEEDED: 'The app’s encrypted storage limit was reached. Keep this tab open and preserve any private receipt. Check an approved transaction’s status before trying again.',
    MIDNIGHT_JS_C_TX_FAILED: 'The network did not report complete success for this transaction. Check Lace’s transaction history before trying again; part of a transaction may have been recorded.',
    MIDNIGHT_JS_P_COMPOSE_FAILED: 'The app could not prepare the contract transaction. Check the recipient details and that this page is up to date. No automatic retry was made.',
    MIDNIGHT_JS_P_CONTRACT_EXECUTION_FAILED: 'The contract could not execute with these inputs. Check the recipient, amount and contract state. No automatic retry was made.',
    MIDNIGHT_JS_C_SUBMIT_REJECTION_UNDIAGNOSED: 'The transaction submission failed without a confirmed outcome. Check Lace’s transaction history and contract state before trying again.',
    MIDNIGHT_JS_C_FORK_CROSSED_DURING_OPERATION: 'The network changed ledger versions during this action. Check whether the transaction was recorded before reconnecting and trying again.',
  };
  const providerMessages = {
    proveTx: 'Lace’s proof provider could not complete this transaction. Check the saved Run in this app (WASM) setting and current Preview support. No automatic retry was made.',
    balanceTx: 'Lace could not balance or approve this transaction. Open its Midnight account and check usable DUST, any required test-token balance and the pending approval. No automatic retry was made.',
    submitTx: 'Lace could not confirm transaction submission. Check its transaction history and the contract state before trying again; the request may already have reached Preview.',
  };
  try {
    if (error?.type === 'DAppConnectorAPIError' && Object.hasOwn(connectorMessages, error.code)) return connectorMessages[error.code];
    if (error?.code === 'MIDNIGHT_JS_C_PROVIDER_FAILED' && Object.hasOwn(providerMessages, error.method)) return providerMessages[error.method];
    if (typeof error?.code === 'string' && Object.hasOwn(sdkMessages, error.code)) return sdkMessages[error.code];
  } catch { /* Untrusted error objects must not stop safe feedback. */ }
  return 'This action could not finish. Check Lace, its Run in this app (WASM) setting, test network and usable DUST. Keep this tab open while proving. If a transaction was sent, check its status before trying again.';
}

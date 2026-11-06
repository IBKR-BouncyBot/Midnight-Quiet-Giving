/** Adapted from Midnight BallotLab by IBKR-BouncyBot (PolyForm Noncommercial).
 * Real Midnight.js 4.1.1 browser providers, DApp Connector API 4.0.1.
 * Importing does not connect a wallet or send a transaction. The caller selects
 * a wallet and explicit test network, then calls connectNativeBrowserProviders.
 */
import { dappConnectorProofProvider } from '@midnight-ntwrk/midnight-js-dapp-connector-proof-provider';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { getNetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CostModel, Transaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { fromHex, toHex, validatePassword, PasswordValidationError } from '@midnight-ntwrk/midnight-js-utils';
import { resolveNativeBrowserConfig, requireConnectedNetwork, requireLocalWalletProver, requireLaceInternalProving } from './config.mjs';
import { nativeConnectionFailure } from './connection-errors.mjs';

export { validatePassword as validateNativeStoragePassword };
export { nativeConnectionErrorMessage } from './connection-errors.mjs';

export function nativeStoragePasswordMessage(error) {
  // Use the installed SDK's error type, never its message or private payload.
  if (!(error instanceof PasswordValidationError)) return null;
  return 'Choose a stronger password for the keys stored by this app: at least 16 characters using three of uppercase letters, lowercase letters, numbers and symbols. Avoid sequences such as 1234 or abcd, and more than three identical characters in a row. This is separate from your Lace password.';
}

export async function connectNativeBrowserProviders({
  wallet, configuration, passwordProvider, internalProverConfirmed = false, onStage = () => {},
  pageUrl = globalThis.location?.href,
}) {
  if (typeof passwordProvider !== 'function' || typeof onStage !== 'function') throw new TypeError('Password and stage providers must be functions');
  const stage = value => {
    // Only finite stage names leave this module; never configurations, public
    // account identifiers, private data, transactions or error payloads.
    try { onStage(value); } catch { /* Observers cannot change the outcome. */ }
  };
  const connectionStep = async (name, operation) => {
    stage(name);
    try { return await operation(); }
    catch (error) {
      if (error instanceof PasswordValidationError) throw error;
      throw nativeConnectionFailure(name, error);
    }
  };
  const config = await connectionStep('connection-settings', () => resolveNativeBrowserConfig(configuration, pageUrl));
  if (!wallet || typeof wallet.connect !== 'function' || !/^4\.\d+\.\d+(?:[-+].*)?$/.test(wallet.apiVersion)) {
    throw new TypeError('Select a DApp Connector API 4 wallet');
  }
  const isolatedDeveloper = config.networkId === 'undeployed';
  if (isolatedDeveloper) {
    // The legacy automated harness is only available from a loopback page.
    // It is never evidence of Lace or public Preview browser-only proving.
    await connectionStep('connection-settings', () => {
      if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(pageUrl).hostname)) {
        throw new Error('Run the isolated developer harness from a loopback page');
      }
    });
  } else {
    await connectionStep('connection-internal-prover', () => requireLaceInternalProving(wallet, internalProverConfirmed));
  }
  // Fail before connecting or transacting if storage cannot encrypt its key.
  validatePassword(await passwordProvider());
  const api = await connectionStep('connection-permission', () => wallet.connect(config.networkId));
  const [status, services, shielded, unshielded] = await connectionStep('connection-account', async () => {
    const values = await Promise.all([
      api.getConnectionStatus(), api.getConfiguration(), api.getShieldedAddresses(), api.getUnshieldedAddress(),
    ]);
    if (!values[3]?.unshieldedAddress || !values[2]?.shieldedCoinPublicKey || !values[2]?.shieldedEncryptionPublicKey) {
      throw new Error('Missing required public account identifiers');
    }
    return values;
  });
  await connectionStep('connection-network', () => requireConnectedNetwork(status, services, config.networkId));
  const provingStage = isolatedDeveloper ? 'connection-local-prover' : 'connection-internal-prover';
  const checkProvingConfiguration = value => isolatedDeveloper ? requireLocalWalletProver(value)
    : requireLaceInternalProving(wallet, internalProverConfirmed, value);
  const provingConfiguration = await connectionStep(provingStage, () => checkProvingConfiguration(services));
  const accountId = unshielded.unshieldedAddress;
  const coinKey = shielded.shieldedCoinPublicKey;
  const encryptionKey = shielded.shieldedEncryptionPublicKey;
  setNetworkId(config.networkId);
  let closed = false;
  const assertSession = async () => {
    if (closed) throw new Error('This native wallet session is closed');
    if (getNetworkId() !== config.networkId) throw new Error('Midnight.js network changed');
    const [connection, currentServices, currentShielded, currentUnshielded] = await Promise.all([
      api.getConnectionStatus(), api.getConfiguration(), api.getShieldedAddresses(), api.getUnshieldedAddress(),
    ]);
    requireConnectedNetwork(connection, currentServices, config.networkId);
    // A changed/reported HTTP prover fails before every prove, balance and
    // submit. API 4 cannot detect an internal-WASM -> TEE switch: the user must
    // keep the confirmed Lace setting. No HTTP proving fallback exists here.
    if (checkProvingConfiguration(currentServices) !== provingConfiguration) throw new Error('Wallet prover changed; reconnect');
    if (currentUnshielded?.unshieldedAddress !== accountId || currentShielded?.shieldedCoinPublicKey !== coinKey
      || currentShielded?.shieldedEncryptionPublicKey !== encryptionKey) throw new Error('Wallet account changed; reconnect');
  };
  // Reject redirects as well as cross-origin paths. Prover/verifier files are
  // public, but silently changing their source breaks deployment provenance.
  const artifactFetch = (url, init) => {
    const target = new URL(url);
    const base = new URL(config.compiledAssetsUrl);
    if (target.origin !== base.origin || !target.pathname.startsWith(`${base.pathname}/`)) {
      throw new Error('Compiled asset request escaped the selected asset directory');
    }
    return globalThis.fetch(target.href, { ...init, redirect: 'error', credentials: 'same-origin' });
  };
  const zkConfigProvider = await connectionStep('connection-providers', () => new FetchZkConfigProvider(config.compiledAssetsUrl, artifactFetch));
  const underlyingProof = await connectionStep('connection-proving-provider',
    () => dappConnectorProofProvider(api, zkConfigProvider, CostModel.initialCostModel()));
  const walletProvider = {
    getCoinPublicKey: () => coinKey,
    getEncryptionPublicKey: () => encryptionKey,
    async balanceTx(transaction) {
      await assertSession();
      stage('wallet-approval-requested');
      const balanced = await api.balanceUnsealedTransaction(toHex(transaction.serialize()));
      const result = Transaction.deserialize('signature', 'proof', 'binding', fromHex(balanced.tx));
      stage('wallet-balanced');
      return result;
    },
  };
  const privateStateProvider = await connectionStep('connection-storage', () => levelPrivateStateProvider({
      accountId: `${config.networkId}:${accountId}`,
      privateStateStoreName: 'midnight-private-donations-private-state',
      signingKeyStoreName: 'midnight-private-donations-signing-keys',
      privateStoragePasswordProvider: passwordProvider,
    }));
  const publicDataProvider = await connectionStep('connection-providers',
    () => indexerPublicDataProvider(config.indexerUri, config.indexerWsUri, globalThis.WebSocket));
  const providers = {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider: {
      async proveTx(transaction, options) {
        await assertSession();
        stage('proving-provider-started');
        const proven = await underlyingProof.proveTx(transaction, options);
        // Deployments can traverse this provider without a contract-call proof.
        // This event means the provider returned, not that a network accepted it.
        stage('proving-provider-completed');
        return proven;
      },
    },
    walletProvider,
    midnightProvider: {
      async submitTx(transaction) {
        await assertSession();
        await api.submitTransaction(toHex(transaction.serialize()));
        stage('submission-returned');
        const identifier = transaction.identifiers()[0];
        if (!identifier) throw new Error('Submitted transaction did not have an identifier');
        return identifier;
      },
    },
  };
  stage('wallet-connected');
  return Object.freeze({ providers, networkId: config.networkId, compiledAssetsPath: config.compiledAssetsUrl,
    provingMode: isolatedDeveloper ? 'isolated-developer-local-prover' : 'lace-internal-wasm-user-confirmed',
    provingModeAttestedByWallet: false,
    assertSession,
    // This invalidates application use. It does not revoke wallet permissions,
    // erase IndexedDB or claim that in-flight submission can be cancelled.
    close() { closed = true; },
  });
}

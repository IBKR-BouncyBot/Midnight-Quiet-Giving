/** Adapted from Midnight BallotLab by IBKR-BouncyBot (PolyForm Noncommercial).
 * Real Midnight.js 5 browser providers, DApp Connector API 4.1.
 * Importing does not connect a wallet or send a transaction. The caller selects
 * a wallet and explicit test network, then calls connectNativeBrowserProviders.
 */
import { dappConnectorProofProvider, dappConnectorWalletProviders } from '@midnight-ntwrk/midnight-js-dapp-connector-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { CostModel } from '@midnight-ntwrk/midnight-js-protocol/v9';
import { validatePassword, PasswordValidationError } from '@midnight-ntwrk/midnight-js-utils';
import { resolveNativeBrowserConfig, requireConnectedNetwork, requireLocalWalletProver, requireLaceInternalProving } from './config.mjs';
import { nativeConnectionFailure } from './connection-errors.mjs';
import { createProviderConfig, LEDGER9_ERAS, requireLedger9Transaction, finalizedTransactionIdentifier } from './ledger9.mjs';
import { createDonationZkConfigProvider } from './artifact-provider.mjs';

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
  let closed = false;
  const assertSession = async () => {
    if (closed) throw new Error('This native wallet session is closed');
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
  const zkConfigProvider = await connectionStep('connection-providers', () => createDonationZkConfigProvider(config.compiledAssetsUrl));
  const underlyingProof = await connectionStep('connection-proving-provider',
    () => dappConnectorProofProvider(api, zkConfigProvider, CostModel.initialCostModel()));
  const connector = await connectionStep('connection-providers', () => dappConnectorWalletProviders(api));
  const walletProvider = {
    supportedEras: LEDGER9_ERAS,
    getCoinPublicKey: () => coinKey,
    getEncryptionPublicKey: () => encryptionKey,
    async balanceTx(transaction, ttl) {
      requireLedger9Transaction(transaction, 'Unbound');
      await assertSession();
      stage('wallet-approval-requested');
      // API 4 has no TTL argument; the official adapter preserves the call
      // interface while Lace chooses its own additional intent's expiry.
      const result = await connector.walletProvider.balanceTx(transaction, ttl);
      stage('wallet-balanced');
      return result;
    },
  };
  const privateStateProvider = await connectionStep('connection-storage', () => levelPrivateStateProvider({
      accountId: `${config.networkId}:ledger9:${accountId}`,
      privateStateStoreName: 'midnight-private-donations-ledger9-private-state',
      signingKeyStoreName: 'midnight-private-donations-ledger9-signing-keys',
      privateStoragePasswordProvider: passwordProvider,
    }));
  const publicDataProvider = await connectionStep('connection-providers',
    () => indexerPublicDataProvider(config.indexerUri, config.indexerWsUri, globalThis.WebSocket));
  const providers = {
    config: createProviderConfig(config.networkId),
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider: {
      supportedEras: LEDGER9_ERAS,
      async proveTx(transaction, options) {
        requireLedger9Transaction(transaction, 'Unproven');
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
      supportedEras: LEDGER9_ERAS,
      async submitTx(transaction) {
        // Validate before requesting a submission, so a malformed return can
        // never be mistaken for an unsubmitted transaction after dispatch.
        const identifier = finalizedTransactionIdentifier(transaction);
        await assertSession();
        await connector.midnightProvider.submitTx(transaction);
        stage('submission-returned');
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
    async close() { closed = true; await publicDataProvider.dispose(); },
  });
}

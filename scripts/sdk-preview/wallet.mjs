import { randomBytes } from 'node:crypto';
import * as SDK from '@midnightntwrk/wallet-sdk';
import { MidnightWalletProvider, logger } from '@midnight-ntwrk/testkit-js';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/v9';
import { PREVIEW, AcceptanceFailure, bounded, pause, requireCondition, requireRemoteRunner } from './runtime.mjs';

export async function createEphemeralWallet({ proving, onState }) {
  requireRemoteRunner(); logger.level = 'silent';
  const master = randomBytes(32);
  let seeds;
  try { seeds = SDK.WalletSeeds.fromMasterSeed(master); } finally { master.fill(0); }
  const keystore = SDK.createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, 'preview');
  const unshieldedAddress = keystore.getBech32Address().asString();
  requireCondition(/^mn_addr_preview1[023456789acdefghjklmnpqrstuvwxyz]+$/.test(unshieldedAddress), 'INVALID_PREVIEW_WALLET_ADDRESS');
  const history = () => new SDK.InMemoryTransactionHistoryStorage(SDK.WalletEntrySchema, SDK.mergeWalletEntries);
  const wallet = await SDK.WalletFacade.init({
    configuration: { networkId: 'preview', relayURL: new URL(PREVIEW.nodeWS),
      indexerClientConnection: { indexerHttpUrl: PREVIEW.indexer, indexerWsUrl: PREVIEW.indexerWS },
      txHistoryStorage: history(), costParameters: { additionalFeeOverhead: 0n, feeBlocksMargin: 5 },
      provers: { v9: { kind: 'wasm', keyMaterialProvider: proving.nativeKeys } } },
    shielded: config => SDK.ShieldedWallet(config).startWithSeed(seeds.shielded),
    unshielded: config => SDK.UnshieldedWallet({ ...config, txHistoryStorage: history() }).startWithPublicKey(SDK.PublicKey.fromKeyStore(keystore)),
    dust: config => SDK.DustWallet(config).startWithSeed(seeds.dust),
    provingService: () => proving.walletProvingService,
  });
  const provider = await MidnightWalletProvider.withWallet(logger, PREVIEW, wallet, seeds, keystore);
  let latest = null, streamFailed = false;
  const subscription = wallet.state().subscribe({ next(state) {
    latest = state;
    onState?.({ synced: state.isSynced === true, protocolVersion: state.activeProtocolVersion,
      nightStar: String(state.unshielded.balances[unshieldedToken().raw] ?? 0n), dustSpeck: String(state.dust.balance(new Date())) });
  }, error() { streamFailed = true; } });
  return {
    wallet, provider, keystore, unshieldedAddress,
    start: () => provider.start(false),
    latest: () => latest,
    publicAddresses() {
      requireCondition(latest, 'WALLET_STATE_UNAVAILABLE');
      return { unshieldedAddress, shieldedAddress: SDK.MidnightBech32m.encode('preview', latest.shielded.address).asString(),
        dustAddress: SDK.MidnightBech32m.encode('preview', latest.dust.address).asString() };
    },
    async waitFor(predicate, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        requireCondition(!streamFailed, 'WALLET_STATE_STREAM_FAILED');
        if (latest && predicate(latest)) return latest;
        await pause(1000);
      }
      throw new AcceptanceFailure('WALLET_STATE_TIMEOUT');
    },
    async close() {
      subscription.unsubscribe(); await bounded(provider.stop(), 20_000, 'WALLET_STOP_TIMEOUT').catch(() => {});
      for (const seed of Object.values(seeds)) seed.fill(0);
    },
  };
}

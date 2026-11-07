/** Real ledger-9 acceptance with fresh, ephemeral wallets on our own GitHub runner.
 * This is SDK evidence, never Lace evidence. No recovery seed or disclosure is saved.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { PREVIEW, GENESIS, AcceptanceFailure, requireRemoteRunner, requireCondition, bounded, pause, atomicJson, failureFacts } from './sdk-preview/runtime.mjs';

requireRemoteRunner();
const root = resolve(import.meta.dirname, '..'), directory = join(root, 'artifacts/sdk-preview');
await mkdir(directory, { recursive: true });
const startedAt = new Date().toISOString();
const report = { version: 1, kind: 'quiet-giving-sdk-preview-acceptance', status: 'running', startedAt,
  networkId: 'preview', walletKind: 'fresh-internal-sdk-wallet', laceTest: false, realMoneyTransferred: false,
  runner: { runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, sourceCommit: process.env.GITHUB_SHA,
    url: `https://github.com/IBKR-BouncyBot/Midnight-Quiet-Giving/actions/runs/${process.env.GITHUB_RUN_ID}` },
  versions: { walletSdk: '2.0.0', midnightJs: '5.0.0', compactCompiler: '0.36.0', compactRuntime: '0.21.0',
    contractZkir: '3.2.0', nativeWalletZkir: '2.2.0' },
  proving: { mode: 'official-wasm-in-isolated-runner', remoteHttpProverConfigured: false },
  transactions: [], checks: {}, privacy: { seedsPersisted: false, privateDisclosurePersisted: false, separateRecipientWallet: true },
  confirmationSource: 'configured-indexer', independentlyVerified: false, taxAuthorityAccepted: false };
let stage = 'initializing', donor, recipient, proving, publicDataProvider, authorityProvider, completed = false;
const save = () => atomicJson(join(directory, 'evidence.json'), report);
async function setStage(value) {
  stage = value; report.stage = value;
  await atomicJson(join(directory, 'status.json'), { status: report.status, stage, updatedAt: new Date().toISOString() });
  await save();
}
async function shutdown() {
  await Promise.allSettled([donor?.close(), recipient?.close(), publicDataProvider?.dispose(), authorityProvider?.dispose(), proving?.close()]);
}
async function fail(error, status = 'failed') {
  if (completed) return;
  completed = true; report.status = status; report.failedStage = stage; report.failure = failureFacts(error);
  report.completedAt = new Date().toISOString(); await save().catch(() => {});
  await shutdown(); process.exit(1);
}
process.once('SIGTERM', () => { void fail(new AcceptanceFailure('RUNNER_STOPPED'), 'cancelled'); });
process.once('SIGINT', () => { void fail(new AcceptanceFailure('RUNNER_STOPPED'), 'cancelled'); });
process.once('uncaughtException', error => { void fail(error); });
process.once('unhandledRejection', error => { void fail(error); });
// Library output is not part of the evidence and may contain transaction internals.
for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir']) console[method] = () => {};

try {
  await setStage('checking-preview-genesis');
  const [{ default: WebSocket }, { createRunnerProving }, { createEphemeralWallet }, SDK,
    { inMemoryPrivateStateProvider }, { NodeZkConfigProvider }, { indexerPublicDataProvider },
    { createNetworkClient, verifyIndexedDisclosure }, { createProviderConfig }, { unshieldedToken }, Native] = await Promise.all([
    import('ws'), import('./sdk-preview/proving.mjs'), import('./sdk-preview/wallet.mjs'), import('@midnightntwrk/wallet-sdk'),
    import('@midnight-ntwrk/testkit-js'), import('@midnight-ntwrk/midnight-js-node-zk-config-provider'),
    import('@midnight-ntwrk/midnight-js-indexer-public-data-provider'), import('../lib/network/sdk-client.mjs'),
    import('../lib/network/ledger9.mjs'), import('@midnight-ntwrk/midnight-js-protocol/v9'),
    import('../contracts/managed/donations/contract/index.js'),
  ]);
  const ws = new WebSocket(PREVIEW.nodeWS);
  try {
    const results = await bounded(new Promise((accept, reject) => {
      const found = new Map();
      ws.once('error', () => reject(new AcceptanceFailure('PREVIEW_RPC_UNAVAILABLE')));
      ws.once('open', () => {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain_getBlockHash', params: [0] }));
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'state_getRuntimeVersion', params: [] }));
      });
      ws.on('message', bytes => {
        try {
          const value = JSON.parse(bytes.toString());
          if (![1, 2].includes(value.id)) return;
          if (value.error) return reject(new AcceptanceFailure('PREVIEW_RPC_REJECTED'));
          found.set(value.id, value.result); if (found.size === 2) accept(found);
        } catch { reject(new AcceptanceFailure('PREVIEW_RPC_RESPONSE_INVALID')); }
      });
    }), 30_000, 'PREVIEW_RPC_TIMEOUT');
    requireCondition(results.get(1) === GENESIS && results.get(2)?.specVersion >= 2_000_000, 'PREVIEW_CHAIN_CHANGED');
    report.chain = { genesisHash: results.get(1), runtimeSpecVersion: results.get(2).specVersion,
      transactionVersion: results.get(2).transactionVersion };
  } finally { ws.terminate(); }
  const assets = join(root, 'contracts/managed/donations');
  const manifest = await readFile(join(assets, 'compiler/contract-manifest.json'));
  const manifestHash = createHash('sha256').update(manifest).digest('hex');
  report.compiledManifestSha256 = manifestHash;
  report.sourceHashes = Object.fromEntries(await Promise.all([
    'scripts/ci-sdk-preview.mjs', 'scripts/sdk-preview/runtime.mjs', 'scripts/sdk-preview/wallet.mjs',
    'scripts/sdk-preview/proving.mjs', 'scripts/sdk-preview/contract-proof-worker.mjs',
    'lib/network/sdk-client.mjs', 'lib/network/maintenance.mjs', 'package-lock.json',
  ].map(async file => [file, createHash('sha256').update(await readFile(join(root, file))).digest('hex')])));
  proving = await createRunnerProving({ compiledAssetsPath: assets, manifestHash, metrics: report.proving });
  await setStage('creating-fresh-internal-wallets');
  donor = await createEphemeralWallet({ proving });
  recipient = await createEphemeralWallet({ proving });
  requireCondition(donor.unshieldedAddress !== recipient.unshieldedAddress, 'SEPARATE_WALLETS_REQUIRED');
  const fundingMinutes = Number(process.env.QUIET_GIVING_FUNDING_WAIT_MINUTES ?? '120');
  requireCondition(Number.isInteger(fundingMinutes) && fundingMinutes >= 1 && fundingMinutes <= 120, 'INVALID_FUNDING_DEADLINE');
  const fundingDeadline = new Date(Date.now() + fundingMinutes * 60_000).toISOString();
  report.donorAddress = donor.unshieldedAddress;
  await atomicJson(join(directory, 'funding-request.json'), { version: 1, networkId: 'preview',
    walletKind: 'fresh-internal-sdk-wallet', unshieldedAddress: donor.unshieldedAddress,
    requestedTestNight: '5000', faucet: 'https://midnight-tmnight-preview.nethermind.dev/',
    createdAt: new Date().toISOString(), expiresAt: fundingDeadline, workflowRunId: process.env.GITHUB_RUN_ID,
    genesisHash: GENESIS, note: 'Valueless Preview test tokens only. Private keys exist only in this running job.' });
  await setStage('awaiting-faucet-funding');
  await bounded(Promise.all([donor.start(), recipient.start()]), 120_000, 'WALLET_START_TIMEOUT');
  const night = unshieldedToken().raw;
  const isCurrent = state => state.isSynced && state.protocol._tag === 'Settled' && state.activeProtocolVersion >= 2_000_000;
  const funded = await donor.waitFor(state => isCurrent(state)
    && (state.unshielded.balances[night] ?? 0n) > 0n, Math.max(1, Date.parse(fundingDeadline) - Date.now()));
  report.funding = { observedAt: new Date().toISOString(), nightStar: String(funded.unshielded.balances[night]),
    source: 'wallet-synchronized-indexer-state' };
  await recipient.waitFor(isCurrent, 120_000);
  report.walletAddresses = { donor: donor.publicAddresses(), recipient: recipient.publicAddresses() };
  publicDataProvider = indexerPublicDataProvider(PREVIEW.indexer, PREVIEW.indexerWS, WebSocket);
  const zkConfigProvider = new NodeZkConfigProvider(assets, { verify: 'require', expectedManifestHash: manifestHash });
  const providers = { config: createProviderConfig('preview'), privateStateProvider: inMemoryPrivateStateProvider(),
    publicDataProvider, zkConfigProvider, proofProvider: proving.proofProvider,
    walletProvider: donor.provider, midnightProvider: donor.provider };
  async function withDustAccrual(operation) {
    try { return await operation(); }
    catch (error) {
      // This precise SDK error is a fee refusal before signing/submission. No
      // submitted transaction, generic network error or ambiguous result retries.
      if (!SDK.isInsufficientDustForFeeError(error) || error.estimate._tag !== 'Reachable') throw error;
      const waitMs = Number(error.estimate.seconds) * 1000 + 15_000;
      requireCondition(Number.isFinite(waitMs) && waitMs >= 15_000 && waitMs <= 15 * 60_000, 'TRANSACTION_DUST_WAIT_TOO_LONG');
      report.checks.preSubmissionFeeWaits = (report.checks.preSubmissionFeeWaits ?? 0) + 1;
      await save(); await pause(waitMs);
      return operation();
    }
  }
  async function acceptTx(operation, id) {
    requireCondition(typeof id === 'string' && /^[0-9a-f]{66}$/.test(id), 'INVALID_SUBMITTED_TRANSACTION_ID');
    const found = await bounded(publicDataProvider.watchForTxData(id), 5 * 60_000, 'TRANSACTION_INCLUSION_TIMEOUT');
    requireCondition(found.era === 'v9' && found.status === 'SucceedEntirely', 'TRANSACTION_NOT_ACCEPTED');
    const value = { operation, txId: found.txId, blockHeight: String(found.blockHeight), status: found.status };
    report.transactions.push(value); await save(); return value;
  }
  await setStage('registering-night-for-dust');
  const unregistered = funded.unshielded.availableCoins.filter(coin => coin.utxo.type === night && coin.meta.registeredForDustGeneration === false);
  requireCondition(unregistered.length > 0, 'FRESH_NIGHT_UTXO_REQUIRED');
  const register = () => donor.wallet.registerNightUtxosForDustGeneration(unregistered, donor.keystore.getPublicKey(), payload => donor.keystore.signDataAsync(payload));
  let registration;
  try { registration = await register(); }
  catch (error) {
    if (!SDK.isInsufficientDustForFeeError(error) || error.estimate._tag !== 'Reachable') throw error;
    const waitMs = Number(error.estimate.seconds) * 1000 + 60_000;
    requireCondition(Number.isFinite(waitMs) && waitMs <= 15 * 60_000, 'DUST_REGISTRATION_WAIT_TOO_LONG');
    await setStage('waiting-for-registration-dust');
    await donor.wallet.waitForGeneratedDust(unregistered, error.fee, { timeoutMs: waitMs });
    registration = await register();
  }
  const finalizedRegistration = await bounded(donor.wallet.finalizeRecipe(registration), 10 * 60_000, 'DUST_REGISTRATION_PROOF_TIMEOUT');
  const registrationId = await donor.wallet.submitTransaction(finalizedRegistration);
  await acceptTx('dust-registration', registrationId);
  await setStage('waiting-for-dust-balance');
  await donor.waitFor(state => state.isSynced && state.dust.balance(new Date()) > 0n, 5 * 60_000);
  // Allow newly registered test NIGHT to accrue enough DUST for the first deployment.
  await pause(60_000);
  report.dustBeforeDeploymentSpeck = String(donor.latest().dust.balance(new Date()));
  const session = async () => requireCondition(donor.latest()?.protocol._tag === 'Settled'
    && donor.latest()?.activeProtocolVersion >= 2_000_000, 'WALLET_PROTOCOL_CHANGED');
  const client = createNetworkClient(providers, { compiledAssetsPath: assets, networkId: 'preview', assertSession: session });
  const recipientKeys = { recipientKey: recipient.provider.getCoinPublicKey(), recipientEncryptionKey: recipient.provider.getEncryptionPublicKey() };
  await setStage('deploying-donation-contract');
  const deployed = await withDustAccrual(() => bounded(client.deploy({ ...recipientKeys, recipientLabel: 'Isolated Preview recipient' }), 12 * 60_000, 'DEPLOYMENT_TIMEOUT'));
  await acceptTx('deploy', deployed.txId);
  const campaign = client.exportJoinFile(); await atomicJson(join(directory, 'public-campaign.json'), campaign);
  await setStage('locking-donation-rules');
  const locked = await withDustAccrual(() => bounded(client.lockRules(), 10 * 60_000, 'RULE_LOCK_TIMEOUT')); await acceptTx('lock-rules', locked.txId);
  await setStage('minting-test-donation-token');
  const minted = await withDustAccrual(() => bounded(client.mint(1000), 12 * 60_000, 'MINT_TIMEOUT')); await acceptTx('mint', minted.txId);
  const color = Buffer.from(Native.pureCircuits.testTokenColor(Uint8Array.from(Buffer.from(campaign.contractAddress, 'hex')))).toString('hex');
  await donor.waitFor(state => state.isSynced && (state.shielded.balances[color] ?? 0n) === 1000n, 5 * 60_000);
  await setStage('submitting-private-donation');
  const donated = await withDustAccrual(() => bounded(client.donate({ amount: 125, taxpayerId: 'Synthetic runner taxpayer' }), 15 * 60_000, 'DONATION_TIMEOUT'));
  requireCondition(donated.transaction?.txId && donated.receiptMatchesIndexedState === true, 'DONATION_RECEIPT_NOT_INDEXED');
  await acceptTx('donate', donated.transaction.txId);
  await setStage('checking-recipient-shielded-balance');
  const received = await recipient.waitFor(state => state.isSynced && (state.shielded.balances[color] ?? 0n) === 125n, 5 * 60_000);
  const donorAfter = await donor.waitFor(state => state.isSynced && (state.shielded.balances[color] ?? 0n) === 875n, 5 * 60_000);
  report.checks.recipientReceivedExpectedTestUnits = received.shielded.balances[color] === 125n;
  report.checks.donorRetainedExpectedChange = donorAfter.shielded.balances[color] === 875n;
  await setStage('verifying-private-disclosure');
  // A separate read-only provider verifies the opening without access to wallet or app state.
  authorityProvider = indexerPublicDataProvider(PREVIEW.indexer, PREVIEW.indexerWS, WebSocket);
  const authority = { publicDataProvider: authorityProvider, zkConfigProvider, networkId: 'preview' };
  const disclosure = client.lastPrivateDisclosure;
  requireCondition(disclosure, 'PRIVATE_DISCLOSURE_MISSING');
  const verified = await verifyIndexedDisclosure(disclosure, authority);
  requireCondition(verified.valid && verified.indexedDonationMatched, 'INDEXED_DISCLOSURE_FAILED');
  const alteredAmount = await verifyIndexedDisclosure({ ...disclosure, amount: disclosure.amount + 1 }, authority);
  const alteredIdentity = await verifyIndexedDisclosure({ ...disclosure, taxpayerId: 'Changed synthetic taxpayer' }, authority);
  requireCondition(alteredAmount.valid === false && alteredIdentity.valid === false, 'TAMPERED_DISCLOSURE_ACCEPTED');
  const record = await client.readState();
  requireCondition(record.rulesLocked && record.totalDonations === 1 && record.totalMints === 1, 'UNEXPECTED_FINAL_CONTRACT_STATE');
  const publicText = JSON.stringify(record);
  for (const privateValue of [disclosure.taxpayerId, disclosure.donorSecret, disclosure.receiptSalt]) {
    requireCondition(!publicText.includes(privateValue), 'PRIVATE_DATA_IN_PUBLIC_RECORD');
  }
  report.checks = { ...report.checks, lockedRules: true, indexedDisclosureMatched: true, changedAmountRejected: true,
    changedTaxpayerRejected: true, publicRecordOmitsPrivateOpening: true, finalDonations: record.totalDonations, finalMints: record.totalMints };
  report.publicReceipt = donated.receipt;
  report.status = 'passed'; report.completedAt = new Date().toISOString(); completed = true;
  await setStage('completed');
  await shutdown(); process.exit(0);
} catch (error) {
  const fundingExpired = stage === 'awaiting-faucet-funding' && !report.funding && error?.code === 'WALLET_STATE_TIMEOUT';
  await fail(fundingExpired ? new AcceptanceFailure('PREVIEW_FUNDING_NOT_OBSERVED') : error, fundingExpired ? 'blocked' : 'failed');
}

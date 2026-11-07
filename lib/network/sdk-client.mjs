/** Real Preview client. Private receipt openings stay in this process.
 * Indexed state is a configured service's observation, not independent chain verification.
 */
import { deployContract, findDeployedContract, submitCallTx, verifyContractState } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import { createShieldedCoinInfo } from '@midnight-ntwrk/midnight-js-protocol/v9';
import { encodeShieldedCoinInfo } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import { parseCoinPublicKeyToHex, parseEncPublicKeyToHex } from '@midnight-ntwrk/midnight-js-utils';
import * as Native from '../../contracts/managed/donations/contract/index.js';
import { randomHex32, hex, bytes, taxpayerDigestFor, createDisclosure, verifyDisclosure } from '../receipt.mjs';
import { requireDevelopmentNetwork } from './config.mjs';
import { isLocked, lockDonationRules } from './maintenance.mjs';
import { decodeDonationContractRead, requireProviderConfig, finalizedTransactionIdentifier } from './ledger9.mjs';

export { randomHex32 };
const PRIVATE_STATE_ID = 'donationTransientWitnessesV1';
const clone = value => value == null ? null : structuredClone(value);
function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw new TypeError('Use a recipient label with 1 to 80 characters');
  return value.trim();
}
function amount(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) throw new TypeError('Amount must be an integer from 1 through 1,000,000 test units');
  return value;
}
function transactionDTO(value) {
  const tx = value?.public ?? value;
  if (tx?.era !== 'v9' || typeof tx?.txId !== 'string' || !/^[0-9a-f]{66}$/.test(tx.txId) || tx.blockHeight === undefined
      || (tx.status !== undefined && tx.status !== 'SucceedEntirely')) throw new Error('Accepted transaction evidence is missing');
  return { txId: tx.txId, blockHeight: String(tx.blockHeight), confirmationSource: 'configured-indexer', independentlyVerified: false };
}
function requireOnlyDonationCircuits(state) {
  const operations = state.operations();
  if (operations.length !== 2 || operations.some(name => typeof name !== 'string' || !['mint', 'donate'].includes(name))) {
    throw new Error('The contract exposes unexpected operations');
  }
}
export function validateJoinFile(value, networkId = 'preview') {
  const fields = ['version', 'kind', 'networkId', 'contractAddress', 'campaignId', 'recipientKey', 'recipientEncryptionKey', 'recipientLabel'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length
      || fields.some(name => !Object.hasOwn(value, name)) || value.version !== 1 || value.kind !== 'donation-campaign'
      || value.networkId !== networkId || !['preview', 'undeployed'].includes(networkId)) throw new TypeError('Unsupported donation campaign file');
  for (const field of ['contractAddress', 'campaignId', 'recipientKey', 'recipientEncryptionKey']) bytes(value[field], field);
  return { ...value, recipientLabel: label(value.recipientLabel) };
}

/** Read-only authority-side check. It sends only the public contract address to
 * the indexer. Taxpayer label, amount and private opening stay in this browser.
 * No wallet or transaction is involved and no tax authority receives anything.
 */
export async function verifyIndexedDisclosure(packet, { publicDataProvider, zkConfigProvider, networkId = 'preview' }) {
  const cryptographic = await verifyDisclosure(packet);
  if (!cryptographic.valid) return cryptographic;
  const r = packet.receipt;
  if (!['preview', 'undeployed'].includes(networkId) || r.mode !== 'network' || r.networkId !== networkId) throw new TypeError('This is not a matching development-network disclosure');
  const currentRead = await publicDataProvider.queryContractState(r.contractAddress);
  if (!currentRead) throw new Error('A locked donation contract is required for verification');
  const chain = decodeDonationContractRead(currentRead);
  if (!isLocked(chain)) throw new Error('A locked donation contract is required for verification');
  // Both expected circuits must match this app's locally packaged verifier keys.
  // Merely finding a map entry in an arbitrary contract cannot verify a payment.
  const keys = await zkConfigProvider.getVerifierKeys(['mint', 'donate']);
  await verifyContractState(keys, currentRead.contractState, r.contractAddress); requireOnlyDonationCircuits(chain);
  // Inspect genesis as well: a counterfeit deployment could otherwise start
  // with fabricated receipts while exposing the same two legitimate circuits.
  const initialRead = await publicDataProvider.queryDeployContractState(r.contractAddress);
  if (!initialRead) throw new Error('The original deployment state is unavailable');
  const initial = decodeDonationContractRead(initialRead);
  await verifyContractState(keys, initialRead.contractState, r.contractAddress); requireOnlyDonationCircuits(initial);
  const original = Native.ledger(initial.data);
  if (original.receipts.size() !== 0n || original.usedNonces.size() !== 0n || original.totalDonations !== 0n || original.totalMints !== 0n
      || hex(original.campaignId) !== r.campaignId || hex(original.recipient.bytes) !== r.recipientKey
      || initial.maintenanceAuthority.counter !== 0n || initial.maintenanceAuthority.threshold !== 1
      || initial.maintenanceAuthority.committee.length !== 1 || chain.maintenanceAuthority.counter !== 1n) {
    throw new Error('The deployment or upgrade history does not match an initially empty, once-locked donation contract');
  }
  const state = Native.ledger(chain.data);
  if (hex(state.campaignId) !== r.campaignId || hex(state.recipient.bytes) !== r.recipientKey
      || !state.receipts.member(bytes(r.receiptId)) || hex(state.receipts.lookup(bytes(r.receiptId))) !== r.commitment) {
    return { ...cryptographic, included: false, indexedDonationMatched: false, message: 'The private opening is consistent, but it does not match this indexed donation contract.' };
  }
  return { ...cryptographic, included: true, indexedDonationMatched: true, paymentVerified: false, taxAccepted: false,
    confirmationSource: 'configured-indexer', independentlyVerified: false,
    message: 'The private opening matches a receipt in the locked donation contract reported by the Preview indexer. It binds the disclosed amount, recipient, validity window and self-entered taxpayer label. This is not verified legal identity, independent chain verification, or tax-authority acceptance.' };
}

export function createNetworkClient(providers, { compiledAssetsPath, networkId, assertSession = async () => {} }) {
  requireDevelopmentNetwork(networkId);
  if (!['preview', 'undeployed'].includes(networkId)) throw new TypeError('This donation client supports Preview and isolated development only');
  if (typeof compiledAssetsPath !== 'string' || !compiledAssetsPath || typeof assertSession !== 'function') throw new TypeError('Asset path and session validator required');
  for (const name of ['privateStateProvider', 'publicDataProvider', 'zkConfigProvider', 'proofProvider', 'walletProvider', 'midnightProvider']) {
    if (!providers?.[name]) throw new TypeError(`Missing provider: ${name}`);
  }
  const requireNetwork = () => requireProviderConfig(providers.config, networkId);
  requireNetwork();
  let handle = null, identity = null, activeInputs = null, busy = false, pending = null, lastDisclosure = null, lastAccepted = null, submissionAttempted = false;
  const accepted = new Map();
  const witnessNames = ['donorSecret', 'taxpayerDigest', 'receiptSalt'];
  const witnesses = Object.fromEntries(witnessNames.map(name => [name, context => {
    if (!activeInputs?.[name]) throw new Error('Private witness scope is unavailable');
    return [context.privateState, activeInputs[name]];
  }]));
  const compiled = CompiledContract.make('donations', Native.Contract).pipe(CompiledContract.withWitnesses(witnesses), CompiledContract.withCompiledFileAssets(compiledAssetsPath));
  const routed = { ...providers, midnightProvider: {
    supportedEras: providers.midnightProvider.supportedEras,
    async submitTx(transaction) {
      const identifier = finalizedTransactionIdentifier(transaction);
      submissionAttempted = true;
      if (pending) pending.submittedTxId = identifier;
      return providers.midnightProvider.submitTx(transaction);
    },
  } };
  async function exclusive(operation) {
    if (busy) throw new Error('A network action is already running');
    busy = true;
    try { requireNetwork(); await assertSession(); return await operation(); }
    finally { activeInputs = null; busy = false; }
  }
  async function readLedger() {
    if (!handle || !identity) throw new Error('Deploy or join a donation campaign first');
    const read = await providers.publicDataProvider.queryContractState(identity.contractAddress);
    if (!read) throw new Error('The contract is not available from the indexer');
    const chain = decodeDonationContractRead(read);
    const ledger = Native.ledger(chain.data);
    if (hex(ledger.campaignId) !== identity.campaignId || hex(ledger.recipient.bytes) !== identity.recipientKey) throw new Error('The indexed campaign does not match the selected recipient');
    return { chain, ledger };
  }
  function receiptDTO(id, commitment) {
    const known = accepted.get(id);
    return { version: 1, kind: 'donation-public-receipt', mode: 'network', networkId,
      campaignId: identity.campaignId, contractAddress: identity.contractAddress, receiptId: id,
      commitment, recipientKey: identity.recipientKey, ...(known ? { txId: known.txId, blockHeight: known.blockHeight } : {}) };
  }
  function recordDTO({ chain, ledger }) {
    return { version: 1, kind: 'donation-public-record', mode: 'network', networkId,
      ...identity, rulesLocked: isLocked(chain), totalDonations: Number(ledger.totalDonations), totalMints: Number(ledger.totalMints),
      receipts: Array.from(ledger.receipts, ([id, commitment]) => receiptDTO(hex(id), hex(commitment))),
      confirmationSource: 'configured-indexer', independentlyVerified: false };
  }
  async function requireLocked() {
    const state = await readLedger();
    if (!isLocked(state.chain)) throw new Error('Lock the contract rules before minting or donating');
    return state;
  }
  async function invoke(circuitId, args, inputs = {}, mappings) {
    submissionAttempted = false; activeInputs = inputs;
    const tx = await submitCallTx(routed, { compiledContract: compiled, circuitId,
      contractAddress: identity.contractAddress, privateStateId: PRIVATE_STATE_ID, args,
      ...(mappings ? { additionalCoinEncPublicKeyMappings: mappings } : {}) });
    const result = transactionDTO(tx);
    lastAccepted = { operation: circuitId, ...result };
    return result;
  }
  async function recover() {
    if (!pending) throw new Error('There is no pending donation');
    const { ledger } = await requireLocked();
    const receipt = pending.disclosure.receipt;
    if (!ledger.receipts.member(bytes(receipt.receiptId)) || hex(ledger.receipts.lookup(bytes(receipt.receiptId))) !== receipt.commitment) {
      throw new Error('This donation is not yet present in the indexed contract. Keep its private backup and do not submit a replacement automatically');
    }
    const observed = pending.transaction;
    if (observed) accepted.set(receipt.receiptId, observed);
    const publicReceipt = receiptDTO(receipt.receiptId, receipt.commitment);
    lastDisclosure = { ...pending.disclosure, receipt: publicReceipt };
    const result = { receipt: publicReceipt, transaction: observed ?? null, receiptMatchesIndexedState: true,
      transactionReferenceVerified: Boolean(observed), confirmationSource: 'configured-indexer', independentlyVerified: false };
    pending = null;
    return result;
  }
  return Object.freeze({
    networkId,
    get contractAddress() { return identity?.contractAddress ?? null; },
    get lastAcceptedTransaction() { return clone(lastAccepted); },
    get pendingDonation() { return pending ? { receiptId: pending.disclosure.receipt.receiptId, submittedTxId: pending.submittedTxId, transaction: clone(pending.transaction) } : null; },
    get lastPrivateDisclosure() { return clone(pending?.disclosure ?? lastDisclosure); },
    getRecipientKeys() {
      return { recipientKey: parseCoinPublicKeyToHex(providers.walletProvider.getCoinPublicKey(), networkId),
        recipientEncryptionKey: parseEncPublicKeyToHex(providers.walletProvider.getEncryptionPublicKey(), networkId) };
    },
    exportJoinFile() { if (!identity) throw new Error('No campaign selected'); return { version: 1, kind: 'donation-campaign', networkId, ...identity }; },
    readState: () => exclusive(async () => recordDTO(await readLedger())),
    async deploy({ recipientKey, recipientEncryptionKey, recipientLabel = 'Community fund' }) { return exclusive(async () => {
      if (handle) throw new Error('A campaign is already selected');
      bytes(recipientKey, 'Recipient coin key'); bytes(recipientEncryptionKey, 'Recipient encryption key');
      const campaignId = randomHex32(); const name = label(recipientLabel);
      submissionAttempted = false;
      const deployed = await deployContract(routed, { compiledContract: compiled, privateStateId: PRIVATE_STATE_ID,
        initialPrivateState: {}, args: [bytes(campaignId), { bytes: bytes(recipientKey) }] });
      handle = deployed;
      const contractAddress = deployed.deployTxData.public.contractAddress;
      bytes(contractAddress, 'Contract address');
      identity = { contractAddress, campaignId, recipientKey, recipientEncryptionKey, recipientLabel: name };
      const result = transactionDTO(deployed.deployTxData);
      lastAccepted = { operation: 'deploy', ...result };
      return { ...result, ...identity };
    }); },
    async join({ contractAddress, recipientKey, recipientEncryptionKey, campaignId, recipientLabel = 'Community fund' }) { return exclusive(async () => {
      if (handle) throw new Error('A campaign is already selected');
      for (const [value, name] of [[contractAddress, 'Contract address'], [recipientKey, 'Recipient coin key'], [recipientEncryptionKey, 'Recipient encryption key']]) bytes(value, name);
      const read = await providers.publicDataProvider.queryContractState(contractAddress);
      if (!read) throw new Error('Contract not found');
      const chain = decodeDonationContractRead(read);
      const ledger = Native.ledger(chain.data);
      if (hex(ledger.recipient.bytes) !== recipientKey || (campaignId && hex(ledger.campaignId) !== campaignId)) throw new Error('The campaign does not match the supplied public details');
      const stored = await providers.privateStateProvider.forContract(contractAddress).get(PRIVATE_STATE_ID);
      const joined = await findDeployedContract(routed, { contractAddress, compiledContract: compiled, privateStateId: PRIVATE_STATE_ID,
        ...(stored === null ? { initialPrivateState: {} } : {}) });
      handle = joined;
      identity = { contractAddress, campaignId: hex(ledger.campaignId), recipientKey, recipientEncryptionKey, recipientLabel: label(recipientLabel) };
      return recordDTO(await readLedger());
    }); },
    async lockRules() { return exclusive(async () => {
      await readLedger(); submissionAttempted = false;
      const tx = await lockDonationRules(routed, identity.contractAddress, chain => Number(Native.ledger(chain.data).totalDonations) === 0, networkId);
      if (!tx) return { alreadyLocked: true };
      const result = transactionDTO(tx); lastAccepted = { operation: 'lock-rules', ...result }; return result;
    }); },
    async mint(value = 1000) { return exclusive(async () => {
      await requireLocked();
      const own = parseCoinPublicKeyToHex(providers.walletProvider.getCoinPublicKey(), networkId);
      return invoke('mint', [{ bytes: bytes(own) }, BigInt(amount(value)), bytes(randomHex32())]);
    }); },
    async donate({ amount: value, taxpayerId }) { return exclusive(async () => {
      if (pending) throw new Error('Resolve the pending donation before sending another');
      await requireLocked(); const units = amount(value);
      const receiptId = randomHex32(), donorSecret = randomHex32(), receiptSalt = randomHex32();
      const digest = await taxpayerDigestFor(taxpayerId);
      const now = Math.floor(Date.now() / 1000), validFrom = now - 60, validUntil = now + 1200;
      const asset = Native.pureCircuits.testTokenColor(bytes(identity.contractAddress));
      const commitment = hex(Native.pureCircuits.receiptCommitment(bytes(identity.campaignId), bytes(identity.contractAddress), bytes(receiptId), bytes(identity.recipientKey), asset,
        BigInt(units), BigInt(validFrom), BigInt(validUntil), bytes(digest), bytes(donorSecret), bytes(receiptSalt)));
      const receipt = receiptDTO(receiptId, commitment);
      const disclosure = await createDisclosure({ receipt, taxpayerId, amount: units, validFrom, validUntil, donorSecret, receiptSalt });
      pending = { disclosure, submittedTxId: null, transaction: null }; lastDisclosure = disclosure;
      const coin = encodeShieldedCoinInfo(createShieldedCoinInfo(hex(asset), BigInt(units)));
      const mappings = new Map([[identity.recipientKey, identity.recipientEncryptionKey]]);
      try {
        pending.transaction = await invoke('donate', [coin, bytes(receiptId), BigInt(validFrom), BigInt(validUntil)],
          { donorSecret: bytes(donorSecret), taxpayerDigest: bytes(digest), receiptSalt: bytes(receiptSalt) }, mappings);
      } catch (error) {
        if (!submissionAttempted) pending = null;
        throw error;
      }
      return recover();
    }); },
    recoverPendingDonation: () => exclusive(recover),
    async verifyTaxDisclosure(packet) { return exclusive(async () => {
      const cryptographic = await verifyDisclosure(packet);
      if (!cryptographic.valid) return cryptographic;
      const receipt = packet.receipt;
      if (receipt.mode !== 'network' || receipt.networkId !== networkId || receipt.contractAddress !== identity?.contractAddress
          || receipt.campaignId !== identity?.campaignId || receipt.recipientKey !== identity?.recipientKey) throw new Error('This disclosure belongs to another campaign or network');
      return verifyIndexedDisclosure(packet, { publicDataProvider: providers.publicDataProvider, zkConfigProvider: providers.zkConfigProvider, networkId });
    }); },
  });
}

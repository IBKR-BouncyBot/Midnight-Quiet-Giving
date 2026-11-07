/** Real generated Compact execution and commitment checks. The browser lab
 * runs every role locally; balances are illustrative and no proof or transaction
 * is submitted. Private receipt material remains in memory until explicit export.
 */
import * as RT from '@midnight-ntwrk/compact-runtime';
import * as Native from '../contracts/managed/donations/contract/index.js';
import { hex, bytes, randomHex32, integer, normalizeTaxpayerId, taxpayerDigestFor, createDisclosure as makeDisclosure, verifyDisclosure as checkDisclosure } from './receipt.mjs';
export { verifyDisclosure, createDisclosure, commitmentForDisclosure, validatePublicReceipt, validatePublicRecord, taxpayerDigestFor, sha256Text, hex, bytes, randomHex32 } from './receipt.mjs';

export const RECIPIENTS = Object.freeze([
  Object.freeze({ id: 'community', name: 'Community kitchen', description: 'Meals and a place to belong.' }),
  Object.freeze({ id: 'education', name: 'Open learning fund', description: 'Make room for someone to learn.' }),
  Object.freeze({ id: 'relief', name: 'Emergency relief', description: 'Help when it matters most.' }),
]);
export const nativeWitnesses = Object.freeze(Object.fromEntries(['donorSecret', 'taxpayerDigest', 'receiptSalt'].map(name => [name, ({ privateState }) => {
  if (!privateState || !Object.hasOwn(privateState, name)) throw new Error(`Missing private input: ${name}`);
  return [privateState, privateState[name]];
}])));

export async function createNativeHarness({ now, campaignId = randomHex32(), recipientKey = randomHex32(), contractAddress = RT.sampleContractAddress(), onCircuit } = {}) {
  bytes(campaignId); bytes(recipientKey); bytes(contractAddress);
  const contract = new Native.Contract(nativeWitnesses);
  const coinPublicKey = randomHex32();
  const initial = await contract.initialState(RT.createConstructorContext({}, coinPublicKey), bytes(campaignId), { bytes: bytes(recipientKey) });
  let currentState = initial.currentContractState;
  let pending = Promise.resolve();
  let clock = now;
  let lastResult = null;
  const time = () => integer(clock ?? Math.floor(Date.now() / 1000), 'Local time', 1, 4102444800);
  function call(name, args = [], privateState = {}) {
    // Generated circuits now await witnesses. Serialize local calls so concurrent
    // requests cannot both execute against the same pre-donation state.
    const execution = pending.then(async () => {
      if (!Object.hasOwn(contract.impureCircuits, name)) throw new Error('Unknown circuit');
      const beforeContext = RT.createCircuitContext({ circuitId: name, contractAddress,
        coinPublicKeyOrZswapState: coinPublicKey, contractState: currentState, privateState, time: time() });
      const result = await contract.impureCircuits[name](beforeContext, ...args);
      currentState = result.context.callContext.currentQueryContext.state;
      lastResult = result;
      onCircuit?.({ name, args, beforeContext, result });
      return result;
    });
    pending = execution.catch(() => {});
    return execution;
  }
  return Object.freeze({ contractAddress, campaignId, recipientKey, coinPublicKey, contract, initial, pure: Native.pureCircuits,
    state: () => Native.ledger(currentState.data ?? currentState), call, time, setTime(value) { clock = integer(value, 'Local time', 1, 4102444800); },
    get lastResult() { return lastResult; },
  });
}

export async function createDonationLab({ now, onCircuit } = {}) {
  const campaigns = new Map();
  for (const recipient of RECIPIENTS) campaigns.set(recipient.id, await createNativeHarness({ now, onCircuit }));
  const donations = new Map();
  const privateOpenings = new Map();
  const donorTotals = Object.create(null);
  function publicRecord() {
    // Reconstruct from native ledger state rather than trusting imported JSON.
    const receipts = [];
    for (const native of campaigns.values()) {
      for (const [id, commitment] of native.state().receipts) receipts.push({ version: 1, kind: 'donation-public-receipt', mode: 'native-local',
        campaignId: native.campaignId, contractAddress: native.contractAddress, receiptId: hex(id), commitment: hex(commitment), recipientKey: native.recipientKey });
    }
    return { version: 1, kind: 'donation-public-record', mode: 'native-local', receipts };
  }
  async function donate({ donor = 'Anonymous donor', taxpayerId, amount, recipient = 'community' } = {}) {
    if (typeof donor !== 'string' || donor.trim().length < 1 || donor.trim().length > 40 || /[\u0000-\u001f]/.test(donor)) throw new TypeError('Use a donor label of 1 to 40 characters');
    donor = donor.trim(); taxpayerId = normalizeTaxpayerId(taxpayerId);
    integer(amount, 'Donation amount', 1, 1000000);
    if (!campaigns.has(recipient)) throw new TypeError('Choose a demonstration recipient');
    const native = campaigns.get(recipient), receiver = RECIPIENTS.find(item => item.id === recipient);
    const receiptId = randomHex32(), donorSecret = randomHex32(), receiptSalt = randomHex32();
    const validFrom = native.time(), validUntil = validFrom + 1200;
    const identityDigest = await taxpayerDigestFor(taxpayerId);
    const coin = { nonce: bytes(randomHex32()), color: native.pure.testTokenColor(bytes(native.contractAddress)), value: BigInt(amount) };
    await native.call('donate', [coin, bytes(receiptId), BigInt(validFrom), BigInt(validUntil)], {
      donorSecret: bytes(donorSecret), taxpayerDigest: bytes(identityDigest), receiptSalt: bytes(receiptSalt),
    });
    const receipt = { version: 1, kind: 'donation-public-receipt', mode: 'native-local', campaignId: native.campaignId,
      contractAddress: native.contractAddress, receiptId, commitment: hex(native.state().receipts.lookup(bytes(receiptId))), recipientKey: native.recipientKey };
    const opening = await makeDisclosure({ receipt, taxpayerId, amount, validFrom, validUntil, donorSecret, receiptSalt });
    const entry = { receipt, donor, amount, recipient, recipientName: receiver.name, date: new Date(validFrom * 1000).toISOString().slice(0, 10) };
    donations.set(receiptId, entry); privateOpenings.set(receiptId, opening);
    donorTotals[donor] = (donorTotals[donor] ?? 0) + amount;
    return structuredClone({ ...entry, opening });
  }
  function getOpening(receiptId) {
    if (!privateOpenings.has(receiptId)) throw new Error('This session does not hold that private receipt');
    return structuredClone(privateOpenings.get(receiptId));
  }
  return Object.freeze({
    donate,
    getState() { return { mode: 'native-local', totalDonations: donations.size, donations: structuredClone([...donations.values()]),
      recipientTotals: RECIPIENTS.map(recipient => ({ id: recipient.id, name: recipient.name, total: [...donations.values()].filter(item => item.recipient === recipient.id).reduce((sum, item) => sum + item.amount, 0) })),
      donorTotals: { ...donorTotals } }; },
    createDisclosure: getOpening, getOpening,
    exportPublicRecord: publicRecord,
    async verifyDisclosure(packet) {
      const result = await checkDisclosure(packet, publicRecord());
      if (!result.valid || !result.included) return { ...result, valid: false, message: result.valid ? 'Receipt is not in this browser session. Importing a private packet cannot establish a completed donation.' : result.message };
      const nativeEntry = [...campaigns.entries()].find(([, native]) => native.contractAddress === packet.receipt.contractAddress);
      result.disclosed.recipientName = RECIPIENTS.find(item => item.id === nativeEntry[0]).name;
      result.message = 'Private receipt matches a donation executed by the generated Compact contract in this browser. No blockchain payment, identity check or tax approval is implied.';
      return result;
    },
  });
}

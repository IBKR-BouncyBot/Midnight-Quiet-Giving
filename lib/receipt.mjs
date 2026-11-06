import { pureCircuits } from '../contracts/managed/donations/contract/index.js';

const HEX = /^[0-9a-f]{64}$/;
export const hex = value => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
export function bytes(value, label = 'Value') {
  if (typeof value !== 'string' || !HEX.test(value) || /^0+$/.test(value)) throw new TypeError(`${label} must be a nonzero 32-byte lowercase hexadecimal value`);
  return Uint8Array.from(value.match(/../g), pair => Number.parseInt(pair, 16));
}
export function randomHex32() {
  let value;
  do { value = globalThis.crypto.getRandomValues(new Uint8Array(32)); } while (value.every(byte => byte === 0));
  return hex(value);
}
export function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`${label} is out of range`);
  return value;
}
function objectFields(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected an object');
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw new TypeError('Missing or unexpected fields');
}
export async function sha256Text(value) {
  if (typeof value !== 'string') throw new TypeError('Text is required');
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
export function normalizeTaxpayerId(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError('Use a demonstration taxpayer identifier of 1 to 80 characters');
  return value.trim();
}
export const taxpayerDigestFor = value => sha256Text(`private-donations:taxpayer:v1\0${normalizeTaxpayerId(value)}`);

export function validatePublicReceipt(receipt) {
  objectFields(receipt, ['version', 'kind', 'mode', 'campaignId', 'contractAddress', 'receiptId', 'commitment', 'recipientKey'], ['networkId', 'txId', 'blockHeight']);
  if (receipt.version !== 1 || receipt.kind !== 'donation-public-receipt' || !['native-local', 'network'].includes(receipt.mode)) throw new TypeError('Unsupported public receipt');
  for (const key of ['campaignId', 'contractAddress', 'receiptId', 'commitment', 'recipientKey']) bytes(receipt[key], key);
  if (receipt.mode === 'native-local' && ['networkId', 'txId', 'blockHeight'].some(key => Object.hasOwn(receipt, key))) throw new TypeError('A local receipt cannot claim a network transaction');
  if (receipt.mode === 'network' && !['preview', 'undeployed'].includes(receipt.networkId)) throw new TypeError('Only development network receipts are supported');
  if (Object.hasOwn(receipt, 'txId')) bytes(receipt.txId, 'Transaction id');
  if (Object.hasOwn(receipt, 'blockHeight') && (typeof receipt.blockHeight !== 'string' || !/^(0|[1-9]\d{0,15})$/.test(receipt.blockHeight))) throw new TypeError('Invalid block height');
  return receipt;
}
export function validatePublicRecord(record) {
  objectFields(record, ['version', 'kind', 'mode', 'receipts']);
  if (record.version !== 1 || record.kind !== 'donation-public-record' || !['native-local', 'network'].includes(record.mode) || !Array.isArray(record.receipts) || record.receipts.length > 10000) throw new TypeError('Unsupported public record');
  const identities = new Set();
  for (const receipt of record.receipts) {
    validatePublicReceipt(receipt);
    if (receipt.mode !== record.mode) throw new TypeError('Mixed receipt modes');
    const identity = `${receipt.contractAddress}:${receipt.receiptId}`;
    if (identities.has(identity)) throw new TypeError('Duplicate receipt in public record');
    identities.add(identity);
  }
  return record;
}
function validateDisclosure(packet) {
  objectFields(packet, ['version', 'kind', 'receipt', 'taxpayerId', 'amount', 'validFrom', 'validUntil', 'donorSecret', 'receiptSalt']);
  if (packet.version !== 1 || packet.kind !== 'donation-private-disclosure') throw new TypeError('Unsupported private disclosure');
  validatePublicReceipt(packet.receipt);
  if (packet.taxpayerId !== normalizeTaxpayerId(packet.taxpayerId)) throw new TypeError('Taxpayer identifier must be normalized');
  integer(packet.amount, 'Donation amount', 1, 1000000);
  integer(packet.validFrom, 'Donation window start', 1, 4102444800);
  integer(packet.validUntil, 'Donation window end', 1, 4102444800);
  if (packet.validUntil <= packet.validFrom || packet.validUntil - packet.validFrom > 1800) throw new TypeError('Invalid donation time window');
  bytes(packet.donorSecret, 'Donor secret'); bytes(packet.receiptSalt, 'Receipt salt');
  return packet;
}
export async function commitmentForDisclosure(packet) {
  validateDisclosure(packet);
  const r = packet.receipt;
  return hex(pureCircuits.receiptCommitment(bytes(r.campaignId), bytes(r.contractAddress), bytes(r.receiptId), bytes(r.recipientKey),
    pureCircuits.testTokenColor(bytes(r.contractAddress)), BigInt(packet.amount), BigInt(packet.validFrom), BigInt(packet.validUntil),
    bytes(await taxpayerDigestFor(packet.taxpayerId)), bytes(packet.donorSecret), bytes(packet.receiptSalt)));
}
export async function createDisclosure({ receipt, taxpayerId, amount, validFrom, validUntil, donorSecret, receiptSalt }) {
  const packet = { version: 1, kind: 'donation-private-disclosure', receipt: structuredClone(receipt), taxpayerId: normalizeTaxpayerId(taxpayerId), amount, validFrom, validUntil, donorSecret, receiptSalt };
  if (await commitmentForDisclosure(packet) !== receipt.commitment) throw new Error('Private opening does not match the donation commitment');
  return packet;
}
export async function verifyDisclosure(packet, record) {
  try {
    const expected = await commitmentForDisclosure(packet);
    if (expected !== packet.receipt.commitment) throw new Error('Disclosure does not match the donation commitment');
    let included = false;
    if (record !== undefined) {
      validatePublicRecord(record);
      const r = packet.receipt;
      const candidate = record.receipts.find(item => item.contractAddress === r.contractAddress && item.receiptId === r.receiptId);
      included = Boolean(candidate && ['mode', 'campaignId', 'recipientKey', 'commitment', 'networkId'].every(key => candidate[key] === r[key]));
    }
    return { valid: true, included, mode: packet.receipt.mode, paymentVerified: false, taxAccepted: false,
      disclosed: { taxpayerId: packet.taxpayerId, amount: packet.amount, recipientKey: packet.receipt.recipientKey,
        date: new Date(packet.validFrom * 1000).toISOString().slice(0, 10), validFrom: packet.validFrom, validUntil: packet.validUntil },
      message: included ? 'Private opening matches the commitment in the supplied record. This alone does not verify blockchain settlement or tax eligibility.' : 'Private opening matches its commitment. Independently verify the receipt against the correct contract before relying on it.' };
  } catch (error) {
    return { valid: false, included: false, paymentVerified: false, taxAccepted: false, message: error.message };
  }
}

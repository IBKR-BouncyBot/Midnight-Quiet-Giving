/** Adapted from Agent AI Wallet by IBKR-BouncyBot (PolyForm Noncommercial).
 * Disable upgrade authority before using this donation contract as evidence.
 * A Lace-approved testnet transaction is required; no mainnet is permitted.
 */
import { ContractMaintenanceAuthority, MaintenanceUpdate, ReplaceAuthority, Intent, Transaction, signatureVerifyingKey, signData } from '@midnight-ntwrk/midnight-js-protocol/v9';
import { submitTx } from '@midnight-ntwrk/midnight-js-contracts';
import { LedgerTransaction } from '@midnight-ntwrk/midnight-js-types';
import { decodeDonationContractRead, requireProviderConfig } from './ledger9.mjs';

export function isLocked(state) {
  return state?.maintenanceAuthority?.committee?.length === 0 && state.maintenanceAuthority.threshold === 1;
}

export async function lockDonationRules(providers, address, hasNoDonations, networkId) {
  requireProviderConfig(providers.config, networkId);
  const initialRead = await providers.publicDataProvider.queryContractState(address);
  if (!initialRead) throw new Error('Contract not found');
  const initial = decodeDonationContractRead(initialRead);
  if (isLocked(initial)) return null;
  if (!hasNoDonations(initial)) throw new Error('Lock the rules before accepting any donation');
  const authority = initial.maintenanceAuthority;
  const signingKey = await providers.privateStateProvider.getSigningKey(address);
  if (!signingKey || authority.committee.length !== 1 || authority.threshold !== 1
      || authority.committee[0] !== signatureVerifyingKey(signingKey) || authority.counter >= 4294967295n) {
    throw new Error('The deployment key for this contract is required');
  }
  const disabled = new ContractMaintenanceAuthority([], 1, authority.counter + 1n);
  const unsigned = new MaintenanceUpdate(address, [new ReplaceAuthority(disabled)], authority.counter);
  const update = unsigned.addSignature(0n, signData(signingKey, unsigned.dataToSign));
  const intent = Intent.new(new Date(Date.now() + providers.config.ttlSeconds * 1000)).addMaintenanceUpdate(update);
  requireProviderConfig(providers.config, networkId);
  const tx = Transaction.fromParts(networkId, undefined, undefined, intent);
  const result = await submitTx(providers, { unprovenTx: LedgerTransaction.seal('v9', 'Unproven', tx) });
  if (result.era !== 'v9' || result.status !== 'SucceedEntirely') throw new Error('Rule locking did not succeed entirely');
  const confirmed = decodeDonationContractRead(await providers.publicDataProvider.queryContractState(address));
  if (!isLocked(confirmed) || confirmed.maintenanceAuthority.counter !== authority.counter + 1n) throw new Error('Rule locking could not be confirmed');
  // The deployment key is no longer useful, but only discard after verification.
  await providers.privateStateProvider.removeSigningKey?.(address);
  return result;
}

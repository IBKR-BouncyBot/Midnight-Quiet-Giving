/** Explicit ledger-9 boundaries for the reset Preview chain. */
import { LedgerTransaction, SerializedContractState } from '@midnight-ntwrk/midnight-js-types';
import { Transaction } from '@midnight-ntwrk/midnight-js-protocol/v9';
import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import { requireDevelopmentNetwork } from './config.mjs';

export const TRANSACTION_TTL_SECONDS = 1800;
export const LEDGER9_ERAS = Object.freeze(['v9']);

export function requireProviderConfig(config, networkId) {
  requireDevelopmentNetwork(networkId);
  if (!['preview', 'undeployed'].includes(networkId) || config?.networkId !== networkId
      || !Number.isSafeInteger(config.ttlSeconds) || config.ttlSeconds < 1 || config.ttlSeconds > 3600) {
    throw new TypeError('Matching development-network configuration and a transaction lifetime of at most one hour are required');
  }
  return config;
}

export function createProviderConfig(networkId) {
  return Object.freeze(requireProviderConfig({ networkId, ttlSeconds: TRANSACTION_TTL_SECONDS }, networkId));
}

export function decodeDonationContractRead(read) {
  if (!read || !SerializedContractState.isSerializedContractState(read.contractState)
      || read.contractState.era !== 'v9' || !Number.isSafeInteger(read.protocolVersion) || read.protocolVersion < 2_000_000) {
    throw new Error('A ledger 9 contract state from the current Preview chain is required');
  }
  return read.contractState.deserialize({ v9: ContractState });
}

export function requireLedger9Transaction(value, stage) {
  const handle = LedgerTransaction.require(value, stage, stage === 'Finalized' ? 'submitTx' : stage === 'Unbound' ? 'balanceTx' : 'proveTx');
  if (handle.era !== 'v9') throw new Error('Only ledger 9 transactions are supported by this Preview application');
  return handle;
}

export function finalizedTransactionIdentifier(value) {
  const transaction = requireLedger9Transaction(value, 'Finalized').deserialize({ v9: Transaction });
  const identifier = transaction.identifiers()[0];
  if (typeof identifier !== 'string' || !/^[0-9a-f]{66}$/.test(identifier)) throw new Error('The finalized transaction has no valid inclusion identifier');
  return identifier;
}

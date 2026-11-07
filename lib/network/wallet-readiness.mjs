/** Read-only, bounded checks before a user requests a wallet transaction.
 * API 4.1 reports DUST balance/cap, but does not attest wallet synchronization
 * or that the reported balance will cover the next transaction's actual fee.
 */
const messages = Object.freeze({
  'session-timeout': 'Lace did not answer the connection check within 15 seconds. Unlock its Midnight account and reconnect. No transaction was requested by this check.',
  'session-unavailable': 'The connected Lace account or network could not be checked. Unlock Lace, select Midnight Preview and reconnect. No transaction was requested by this check.',
  'dust-method-unavailable': 'This Lace connector cannot report its DUST balance. Update Lace to a compatible Midnight API 4.1 version and reconnect. No transaction was requested.',
  'dust-timeout': 'Lace did not answer the DUST balance check within 15 seconds. Open its Midnight account, let it synchronize and try again. No transaction was requested by this check.',
  'dust-unavailable': 'Lace could not report its DUST balance. Open its Midnight account and check that synchronization has finished, then try again. No transaction was requested by this check.',
  'dust-invalid': 'Lace returned an unsupported DUST balance response. Update Lace and reconnect before trying again. No transaction was requested.',
  'dust-capacity-zero': 'Lace reports no DUST generation capacity. Open its Midnight Preview account, choose Generate tDUST and register your test NIGHT. Wait for DUST to accrue before deploying. Holding tNIGHT alone does not pay transaction fees. No transaction was requested.',
  'dust-balance-zero': 'Lace reports zero usable DUST. Let its registered test NIGHT generate DUST and wait for the Midnight account to synchronize, then try again. No transaction was requested.',
});
const known = new WeakMap();
function failure(code) {
  const error = new Error(messages[code]);
  error.name = 'NativeTransactionReadinessError';
  known.set(error, messages[code]);
  return error;
}
export function nativeTransactionReadinessMessage(error) { return known.get(error) ?? null; }

async function read(operation, timeoutMs, timeoutCode, failureCode) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(failure(timeoutCode)), timeoutMs); }),
    ]);
  } catch (error) {
    if (known.has(error)) throw error;
    // Preserve only the API error for the caller's existing finite-code mapper.
    // Raw messages, causes and transaction bodies are never used here.
    let connectorError = false;
    try { connectorError = error?.type === 'DAppConnectorAPIError'; } catch { /* Ignore hostile getters. */ }
    if (connectorError) throw error;
    throw failure(failureCode);
  } finally { clearTimeout(timer); }
}

export async function assertNativeTransactionReady(api, assertSession, onStage = () => {}, { timeoutMs = 15_000 } = {}) {
  if (typeof assertSession !== 'function' || typeof onStage !== 'function'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) throw new TypeError('Invalid wallet readiness configuration');
  const stage = name => { try { onStage(name); } catch { /* Observers cannot affect the check. */ } };
  stage('wallet-session-check');
  await read(assertSession, timeoutMs, 'session-timeout', 'session-unavailable');
  if (typeof api?.getDustBalance !== 'function') throw failure('dust-method-unavailable');
  stage('wallet-dust-check');
  const dust = await read(() => api.getDustBalance(), timeoutMs, 'dust-timeout', 'dust-unavailable');
  if (!dust || typeof dust.balance !== 'bigint' || typeof dust.cap !== 'bigint'
      || dust.balance < 0n || dust.cap < 0n) throw failure('dust-invalid');
  if (dust.balance === 0n) throw failure(dust.cap === 0n ? 'dust-capacity-zero' : 'dust-balance-zero');
  stage('wallet-dust-ready');
  // A positive balance is a prerequisite, not a fee estimate or sync proof.
  return { dustReportedPositive: true, feeCoverageVerified: false, synchronizationVerified: false };
}

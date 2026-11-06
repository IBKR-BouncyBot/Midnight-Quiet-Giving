/** Adapted from Midnight BallotLab by IBKR-BouncyBot (PolyForm Noncommercial).
 * Fixed connection diagnostics only. Raw wallet/SDK errors are never retained. */
const messages = Object.freeze({
  'connection-settings': 'The connection settings are not valid. Select a supported development network, matching service addresses and this app’s compiled assets.',
  'connection-permission': 'Wallet access could not be obtained. Unlock Lace, enable Midnight and check its connection request, then try connecting again.',
  'connection-account': 'Lace did not return the required Midnight account information. Open and unlock its Midnight account, select the same test network as this page, then reconnect.',
  'connection-network': 'Lace and this page do not report matching test-network settings. In Lace, select the matching network under Settings → Network → Testnet → Midnight, confirm the change, then reconnect.',
  'connection-internal-prover': 'Select Lace with DApp Connector API 4. In Lace Settings → Midnight → On this device, select Run in this app (WASM), save the configuration and confirm that selection here. Any reported proof-server URL is refused. The wallet API cannot attest the internal mode or distinguish it from remote TEE mode.',
  'connection-local-prover': 'The isolated developer wallet did not report a loopback prover. Check the local developer harness configuration.',
  'connection-proving-provider': 'Lace could not initialize its proving provider. Check Run in this app (WASM), save the configuration and reconnect. If this option is unavailable, update Lace in a supported desktop browser.',
  'connection-storage': 'This browser could not initialize the app’s encrypted storage. Allow site storage for this page, close duplicate app tabs and try connecting again.',
  'connection-providers': 'The network providers could not initialize. Check the selected service addresses and that your browser supports WebSockets, then reconnect.',
});
const knownErrors = new WeakMap();
const rejectedMessage = 'The wallet request was rejected. No automatic retry was made.';
function connectorCode(error) {
  // API 4 errors are structural, not an Error subclass. Inspect only its two
  // documented discriminators; never read message, reason, stack or cause.
  try { return error?.type === 'DAppConnectorAPIError' ? error.code : null; }
  catch { return null; }
}

export function nativeConnectionFailure(stage, error) {
  if (!Object.hasOwn(messages, stage)) throw new TypeError('Unknown connection stage');
  const code = connectorCode(error);
  const message = code === 'Rejected' ? rejectedMessage
    : code === 'PermissionRejected'
      ? 'Lace denied permission for this app. Review its connected-app permissions, unlock the wallet and connect again. No transaction was submitted.'
      : code === 'Disconnected'
        ? 'Lace disconnected while setting up this connection. Unlock the wallet, check its selected Midnight network and reconnect. No transaction was submitted.'
        : `${messages[stage]} No transaction was submitted.`;
  const failure = new Error(message);
  failure.name = 'NativeConnectionError';
  Object.defineProperty(failure, 'stage', { value: stage, enumerable: true });
  knownErrors.set(failure, message);
  return failure;
}

/** Fixed safe text only for errors created here; arbitrary objects return null. */
export function nativeConnectionErrorMessage(error) {
  return knownErrors.get(error) ?? null;
}

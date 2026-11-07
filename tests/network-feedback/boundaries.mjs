/** Test-only failure boundaries for the real network-page event handlers.
 * No keys, funds, proofs, wallet connection or accepted transaction exist here.
 * The production build never imports this file.
 */
import { assertNativeTransactionReady, nativeTransactionReadinessMessage } from '../../lib/network/wallet-readiness.mjs';
let onStage = () => {}, gate = null, deploymentGate = null, mode = 'empty-dust';
const counts = { readinessCalls: 0, deployCalls: 0, submittedTransactions: 0 };
window.__networkFeedbackTest = Object.freeze({
  counts,
  get readinessPending() { return gate !== null; },
  get deploymentPending() { return deploymentGate !== null; },
  setMode(value) {
    if (!['empty-dust', 'wallet-rejected', 'preparation-failed', 'slow-preparation'].includes(value)) throw new Error('Unsupported fixture mode');
    mode = value; gate = null; deploymentGate = null;
  },
  release() { if (!gate) throw new Error('No pending fixture readiness check'); gate(); gate = null; },
  releaseDeployment() { if (!deploymentGate) throw new Error('No pending fixture deployment'); deploymentGate(); deploymentGate = null; },
});
window.midnight = { 'ui-fixture': { name: 'UI regression fixture', rdns: 'io.lace.wallet', apiVersion: '4.1.0',
  connect() { throw new Error('This UI fixture cannot connect a wallet'); } } };

export async function connectNativeBrowserProviders(options) {
  onStage = options.onStage;
  onStage('wallet-connected');
  return {
    networkId: 'preview', compiledAssetsPath: './network-contract', providers: {},
    async assertSession() {},
    async assertTransactionReady() {
      counts.readinessCalls++;
      return assertNativeTransactionReady({ async getDustBalance() {
        await new Promise(resolve => { gate = resolve; });
        return mode === 'empty-dust' ? { cap: 0n, balance: 0n } : { cap: 10n, balance: 1n };
      } }, async () => {}, onStage);
    },
    async close() {},
  };
}
export const nativeStoragePasswordMessage = () => null;
export const nativeConnectionErrorMessage = () => null;
export { nativeTransactionReadinessMessage };
export function createNetworkClient() {
  return {
    contractAddress: null, lastAcceptedTransaction: null, pendingDonation: null, lastPrivateDisclosure: null,
    async deploy() {
      counts.deployCalls++;
      if (mode === 'wallet-rejected') {
        onStage('wallet-approval-requested');
        throw { type: 'DAppConnectorAPIError', code: 'Rejected' };
      }
      if (mode === 'slow-preparation') await new Promise(resolve => { deploymentGate = resolve; });
      throw new Error('Synthetic unexpected failure; PRIVATE_FIXTURE_SENTINEL must never be rendered');
    },
    getRecipientKeys: () => ({ recipientKey: '1'.repeat(64), recipientEncryptionKey: '2'.repeat(64) }),
  };
}
export function validateJoinFile() { throw new Error('Not used by the UI failure test'); }
export function verifyIndexedDisclosure() { throw new Error('No indexed disclosure exists in the UI fixture'); }
export function verifyDisclosure() { throw new Error('No private disclosure exists in the UI fixture'); }
export function indexerPublicDataProvider() { throw new Error('The UI fixture must not query an indexer'); }
export function createDonationZkConfigProvider() { throw new Error('The UI fixture must not fetch proving material'); }

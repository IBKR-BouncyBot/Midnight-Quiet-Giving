import { isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { rename, writeFile } from 'node:fs/promises';

export const PREVIEW = Object.freeze({ networkId: 'preview', walletNetworkId: 'preview',
  node: 'https://rpc.preview.midnight.network', nodeWS: 'wss://rpc.preview.midnight.network',
  indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws' });
export const GENESIS = '0x3c096de209e06a1a8c52be7bda109ee8c891a42288c0a9db5495f9616dd13796';
export class AcceptanceFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function requireCondition(value, code) { if (!value) throw new AcceptanceFailure(code); }
export function requireRemoteRunner() {
  requireCondition(process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true'
    && process.env.GITHUB_REPOSITORY === 'IBKR-BouncyBot/Midnight-Quiet-Giving'
    && (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch'
      || (process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF === 'refs/heads/codex/ledger9-preview'))
    && isAbsolute(process.env.RUNNER_TEMP ?? '')
    && /^[1-9]\d*$/.test(process.env.GITHUB_RUN_ID ?? '')
    && /^[1-9]\d*$/.test(process.env.GITHUB_RUN_ATTEMPT ?? '')
    && /^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA ?? ''), 'REMOTE_OWN_WORKFLOW_REQUIRED');
  for (const name of ['WALLET_SEED', 'TEST_WALLET_SEED', 'MN_TEST_WALLET_SEED', 'WALLET_MNEMONIC', 'MNEMONIC']) {
    requireCondition(process.env[name] === undefined, 'EXTERNAL_WALLET_CREDENTIALS_REFUSED');
  }
  requireCondition(process.env.QUIET_GIVING_PREVIEW_GENESIS === GENESIS, 'PREVIEW_GENESIS_PIN_REQUIRED');
}
export async function bounded(promise, milliseconds, code) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new AcceptanceFailure(code)), milliseconds);
  })]); } finally { clearTimeout(timer); }
}
export const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
export async function atomicJson(path, value) {
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}
export function failureFacts(error) {
  const signals = new Set(), seen = new Set();
  const patterns = { timeout: /timeout|deadline|timed out/i, connection: /socket|fetch|connection|network/i,
    funding: /insufficient|not enough|funds|dust.*fee/i, proof: /proof|proving|zkir/i,
    version: /protocol|epoch|era|version/i, signature: /signature|signing/i,
    indexer: /graphql|indexer|subscription/i, invalidTransaction: /invalid transaction|not.*normal form|validation/i,
    outsideTimeToDismiss: /OutsideTimeToDismiss/i };
  function visit(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return;
    seen.add(value);
    for (const text of [value.message, value._tag]) if (typeof text === 'string') {
      for (const [name, pattern] of Object.entries(patterns)) if (pattern.test(text)) signals.add(name);
    }
    for (const name of ['cause', 'error', 'left', 'right']) visit(value[name], depth + 1);
    visit(value[Symbol.for('effect/Runtime/FiberFailure/Cause')], depth + 1);
  }
  visit(error);
  return { code: error instanceof AcceptanceFailure ? error.code : 'SDK_PREVIEW_OPERATION_FAILED', signals: [...signals] };
}

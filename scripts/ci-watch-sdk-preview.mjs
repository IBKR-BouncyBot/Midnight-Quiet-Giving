/** Observe only curated public progress from the isolated SDK test process. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'linux') throw new Error('Use an isolated GitHub Linux runner');
const mode = process.argv[2];
if (!['--funding-request', '--completion'].includes(mode)) throw new Error('Choose a public observation mode');
const directory = resolve(import.meta.dirname, '../artifacts/sdk-preview');
const deadline = Date.now() + (mode === '--funding-request' ? 10 * 60_000 : 165 * 60_000);
const pidText = (await readFile(resolve(process.env.RUNNER_TEMP, 'quiet-giving-sdk.pid'), 'utf8')).trim();
if (!/^[1-9]\d*$/.test(pidText)) throw new Error('Missing test-process identifier');
const testPid = Number(pidText);
let lastStage;
async function read(name) {
  try {
    const bytes = await readFile(resolve(directory, name));
    if (bytes.length > 1024 * 1024) throw new Error('Oversized public report');
    return JSON.parse(bytes);
  } catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Public test report could not be read'); }
}
while (Date.now() < deadline) {
  const evidence = await read('evidence.json');
  if (evidence?.status === 'passed') {
    console.log(JSON.stringify({ status: 'passed', evidence: 'artifacts/sdk-preview/evidence.json' }));
    process.exit(0);
  }
  if (['failed', 'blocked', 'cancelled'].includes(evidence?.status)) {
    console.log(JSON.stringify({ status: evidence.status, evidence: 'artifacts/sdk-preview/evidence.json' }));
    process.exit(1);
  }
  try { process.kill(testPid, 0); }
  catch {
    console.log(JSON.stringify({ status: 'test-process-ended-without-completed-evidence' }));
    process.exit(1);
  }
  if (mode === '--funding-request') {
    const request = await read('funding-request.json');
    const address = request?.unshieldedAddress ?? request?.donorAddress;
    if (request && request.networkId === 'preview' && typeof address === 'string' && /^mn_addr_preview1[a-z0-9]+$/.test(address)) {
      console.log(JSON.stringify({ status: 'fresh-preview-address-ready', unshieldedAddress: address }));
      process.exit(0);
    }
  }
  const status = await read('status.json');
  const stage = typeof status?.stage === 'string' && /^[a-z0-9-]{1,100}$/.test(status.stage) ? status.stage : 'initializing';
  if (stage !== lastStage) { console.log(JSON.stringify({ status: 'running', stage })); lastStage = stage; }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
console.log(JSON.stringify({ status: 'public-observation-timeout' }));
process.exit(1);

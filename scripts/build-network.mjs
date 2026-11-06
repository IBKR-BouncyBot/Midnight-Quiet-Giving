import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { nativeWasmPlugin } from './native-wasm-plugin.mjs';

export async function buildNetwork(root, dist) {
  const require = createRequire(join(root, 'package.json'));
  const artifacts = [];
  for (const circuit of ['mint', 'donate']) {
    for (const [directory, extension] of [['keys', 'prover'], ['keys', 'verifier'], ['zkir', 'bzkir']]) {
      const file = `${directory}/${circuit}.${extension}`;
      const path = join(root, 'contracts/managed/donations', file);
      if (!(await stat(path)).isFile()) throw new Error('Missing generated circuit material');
      const data = await readFile(path);
      if (!data.length) throw new Error('Empty circuit material');
      await mkdir(join(dist, 'network-contract', directory), { recursive: true });
      await writeFile(join(dist, 'network-contract', file), data);
      artifacts.push({ path: `network-contract/${file}`, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
    }
  }
  const assets = new Map();
  const result = await build({
    absWorkingDir: root, entryPoints: [join(root, 'src/network-app.mjs')], outfile: join(dist, 'network-bundle.mjs'),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    mainFields: ['browser', 'module', 'main'], conditions: ['browser', 'import'],
    inject: [join(root, 'scripts/network-browser-globals.mjs')],
    plugins: [nativeWasmPlugin(assets, { projectRoot: root, assetFolder: 'network-assets', browserPackages: { events: require.resolve('events/'), buffer: require.resolve('buffer/'), assert: require.resolve('assert/') } })],
    minify: true, legalComments: 'inline', metafile: true, logLevel: 'warning',
  });
  if (result.warnings.length) throw new Error('Review network browser build warnings');
  if (Object.values(result.metafile.outputs).flatMap(value => value.imports).some(item => item.external)) throw new Error('Unresolved network dependency');
  const inputs = Object.keys(result.metafile.inputs).map(name => name.replaceAll('\\', '/'));
  for (const required of ['managed/donations/contract/index.js', '/@midnight-ntwrk/compact-runtime/', '/@midnight-ntwrk/ledger-v8/', '/@midnight-ntwrk/midnight-js-contracts/', '/@midnight-ntwrk/midnight-js-dapp-connector-proof-provider/']) {
    if (!inputs.some(path => path.includes(required))) throw new Error(`Missing network implementation: ${required}`);
  }
  if (assets.size < 2) throw new Error('Expected real ledger and onchain WASM');
  for (const [path, bytes] of assets) {
    await mkdir(join(dist, path, '..'), { recursive: true }); await writeFile(join(dist, path), bytes);
  }
  await writeFile(join(dist, 'network-build.json'), JSON.stringify({
    enabled: true, mode: 'preview-network-client', compiler: '0.31.1', runtime: '0.16.0', sdk: '4.1.1',
    wasm: [...assets.keys()], circuitAssets: artifacts, proofGeneration: 'not-established-by-build', networkAcceptance: 'not-established-by-build',
  }, null, 2));
  return { inputs: Object.keys(result.metafile.inputs), wasmAssets: assets.size, circuitAssets: artifacts.length };
}

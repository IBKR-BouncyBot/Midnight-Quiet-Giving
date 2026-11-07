import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { nativeWasmPlugin } from './native-wasm-plugin.mjs';
import { parseZkArtifactManifest, verifyZkArtifactIntegrity } from '@midnight-ntwrk/midnight-js-utils';

export async function buildNetwork(root, dist) {
  const require = createRequire(join(root, 'package.json'));
  const generated = join(root, 'contracts/managed/donations');
  const manifestBytes = await readFile(join(generated, 'compiler/contract-manifest.json'));
  const manifest = parseZkArtifactManifest(manifestBytes.toString('utf8'));
  if (manifest.compilerVersion !== '0.36.0' || manifest.runtimeVersion !== '0.21.0') throw new Error('Generated artifacts do not target the pinned ledger 9 toolchain');
  const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
  verifyZkArtifactIntegrity({ manifest, relativePath: 'contract/index.js', bytes: await readFile(join(generated, 'contract/index.js')), mode: 'require' });
  const artifacts = [];
  for (const circuit of ['mint', 'donate']) {
    for (const [directory, extension] of [['keys', 'prover'], ['keys', 'verifier'], ['zkir', 'bzkir']]) {
      const file = `${directory}/${circuit}.${extension}`;
      const path = join(root, 'contracts/managed/donations', file);
      if (!(await stat(path)).isFile()) throw new Error('Missing generated circuit material');
      const data = await readFile(path);
      if (!data.length) throw new Error('Empty circuit material');
      verifyZkArtifactIntegrity({ manifest, relativePath: file, bytes: data, mode: 'require' });
      await mkdir(join(dist, 'network-contract', directory), { recursive: true });
      await writeFile(join(dist, 'network-contract', file), data);
      artifacts.push({ path: `network-contract/${file}`, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
    }
  }
  const compilerAssets = [];
  for (const name of ['contract-info.json', 'contract-manifest.json']) {
    const file = `compiler/${name}`;
    const data = await readFile(join(generated, file));
    if (name !== 'contract-manifest.json') verifyZkArtifactIntegrity({ manifest, relativePath: file, bytes: data, mode: 'require' });
    await mkdir(join(dist, 'network-contract/compiler'), { recursive: true });
    await writeFile(join(dist, 'network-contract', file), data);
    compilerAssets.push({ path: `network-contract/${file}`, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
  }
  const assets = new Map();
  const browserPackages = { events: require.resolve('events/'), buffer: require.resolve('buffer/'), assert: require.resolve('assert/') };
  const vendorModules = new Map([
    ['@midnightntwrk/ledger-v9', { entry: 'midnight_ledger_wasm_v9.js', file: 'network-ledger-v9.mjs' }],
    ['@midnightntwrk/ledger-v8', { entry: 'midnight_ledger_wasm.js', file: 'network-ledger-v8.mjs' }],
    ['@midnightntwrk/onchain-runtime-v4', { entry: 'midnight_onchain_runtime_wasm.js', file: 'network-onchain-v4.mjs' }],
    ['@midnight-ntwrk/onchain-runtime-v3', { entry: 'midnight_onchain_runtime_wasm.js', file: 'network-onchain-v3.mjs' }],
  ]);
  const vendorInputs = [];
  // Native ESM waits for these modules' real asynchronous WASM instantiation
  // before evaluating the SDK. Keeping that async boundary outside its bundle
  // preserves legitimate synchronous Compact runtime import cycles, without
  // changing SDK source or using Chrome's size-limited synchronous constructor.
  for (const [packageName, { entry, file }] of vendorModules) {
    const packageRoot = join(root, 'node_modules', packageName);
    const installed = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    if (installed.name !== packageName || installed.exports?.browser !== `./${entry}`) throw new Error('Review native browser package entry before bundling');
    const vendor = await build({
      absWorkingDir: root, entryPoints: [join(packageRoot, entry)], outfile: join(dist, file),
      bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
      mainFields: ['browser', 'module', 'main'], conditions: ['browser', 'import'],
      inject: [join(root, 'scripts/network-browser-globals.mjs')],
      plugins: [nativeWasmPlugin(assets, { projectRoot: root, assetFolder: 'network-assets', browserPackages })],
      minify: true, legalComments: 'inline', metafile: true, logLevel: 'warning',
    });
    if (vendor.warnings.length || Object.values(vendor.metafile.outputs).flatMap(value => value.imports).some(item => item.external)) throw new Error('Unresolved native vendor browser dependency');
    vendorInputs.push(...Object.keys(vendor.metafile.inputs));
  }
  const generatedModules = new Set([...vendorModules.values()].map(({ file }) => `./${file}`));
  const result = await build({
    absWorkingDir: root, entryPoints: [join(root, 'src/network-app.mjs')], outfile: join(dist, 'network-implementation.mjs'),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    mainFields: ['browser', 'module', 'main'], conditions: ['browser', 'import'],
    define: { __QUIET_GIVING_MANIFEST_SHA256__: JSON.stringify(manifestSha256) },
    inject: [join(root, 'scripts/network-browser-globals.mjs')],
    plugins: [{
      name: 'generated-native-browser-modules',
      setup(build) {
        build.onResolve({ filter: /^@midnight(?:ntwrk|-ntwrk)\/(?:ledger-v[89]|onchain-runtime-v[34])$/ }, args => {
          const vendor = vendorModules.get(args.path);
          if (!vendor) return { errors: [{ text: 'Unexpected native browser module' }] };
          return { path: `./${vendor.file}`, external: true };
        });
      },
    }, nativeWasmPlugin(assets, { projectRoot: root, assetFolder: 'network-assets', browserPackages })],
    minify: true, legalComments: 'inline', metafile: true, logLevel: 'warning',
  });
  if (result.warnings.length) throw new Error('Review network browser build warnings');
  if (Object.values(result.metafile.outputs).flatMap(value => value.imports).some(item => item.external && !generatedModules.has(item.path))) throw new Error('Unresolved network dependency');
  if (Object.keys(result.metafile.inputs).some(name => name.startsWith('native-wasm:'))) throw new Error('Native WASM must remain outside the synchronous SDK bundle');
  const allInputs = [...new Set([...Object.keys(result.metafile.inputs), ...vendorInputs])];
  const inputs = allInputs.map(name => name.replaceAll('\\', '/'));
  for (const required of ['managed/donations/contract/index.js', '/@midnight-ntwrk/compact-runtime/', '/@midnightntwrk/ledger-v9/', '/@midnight-ntwrk/midnight-js-contracts/', '/@midnight-ntwrk/midnight-js-dapp-connector-proof-provider/']) {
    if (!inputs.some(path => path.includes(required))) throw new Error(`Missing network implementation: ${required}`);
  }
  if (assets.size < 2) throw new Error('Expected real ledger and onchain WASM');
  for (const [path, bytes] of assets) {
    await mkdir(join(dist, path, '..'), { recursive: true }); await writeFile(join(dist, path), bytes);
  }
  await writeFile(join(dist, 'network-bundle.mjs'), `try {
  await import('./network-implementation.mjs');
} catch (error) {
  const status = document.querySelector('#network-status');
  if (status) status.textContent = 'The network client could not initialize. Reload to try again.';
  throw error;
}
`);
  await writeFile(join(dist, 'network-build.json'), JSON.stringify({
    enabled: true, mode: 'preview-network-client', compiler: '0.36.0', runtime: '0.21.0', sdk: '5.0.0', ledgerEra: 'ledger9',
    wasm: [...assets.keys()], nativeModules: [...generatedModules], circuitAssets: artifacts, compilerAssets, manifestSha256, proofGeneration: 'not-established-by-build', networkAcceptance: 'not-established-by-build',
  }, null, 2));
  return { inputs: allInputs, wasmAssets: assets.size, circuitAssets: artifacts.length };
}

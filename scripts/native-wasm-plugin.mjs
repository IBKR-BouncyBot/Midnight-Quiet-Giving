// Packages real installed WASM and preserves its imports/exports; no fallback.
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { builtinModules } from 'node:module';
import { createHash } from 'node:crypto';

export function nativeWasmPlugin(assets, { projectRoot, assetFolder = 'native-assets', browserPackages = {} } = {}) {
const builtins = new Set(builtinModules.flatMap(name => [name, name.replace(/^node:/, '')]));

async function nativeAsset(path) {
  const bytes = await readFile(path);
  // Validate and inspect the actual installed WASM. This does not execute the
  // runtime or test the election; it ensures we package a real WASM module.
  const module = await WebAssembly.compile(bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const name = `${basename(path, '.wasm').replace(/[^a-zA-Z0-9_-]/g, '_')}-${hash}.wasm`;
  const location = `${assetFolder}/${name}`;
  assets.set(location, bytes);
  return { module, location };
}

  return {
    name: 'actual-native-wasm',
    setup(build) {
      const root = resolve(projectRoot ?? build.initialOptions.absWorkingDir ?? process.cwd());
      build.onResolve({ filter: /.*/ }, args => {
        if (Object.hasOwn(browserPackages, args.path)) return { path: browserPackages[args.path] };
        if (args.path.startsWith('node:') || builtins.has(args.path)) {
          return { errors: [{ text: `Node-only dependency cannot enter the native browser bundle: ${args.path}` }] };
        }
      });
      build.onResolve({ filter: /\.wasm$/ }, async args => {
        if (args.namespace === 'native-wasm' || args.pluginData?.resolvingWasm) return;
        const resolved = await build.resolve(args.path, {
          resolveDir: args.resolveDir, kind: args.kind,
          pluginData: { resolvingWasm: true },
        });
        if (resolved.errors.length) return { errors: resolved.errors };
        if (resolved.external || !resolved.path) return { errors: [{ text: 'WASM must resolve to a local installed package file' }] };
        const modulePath = relative(root, resolved.path);
        if (!modulePath || isAbsolute(modulePath) || modulePath === '..' || modulePath.startsWith(`..${sep}`)) {
          return { errors: [{ text: 'Native WASM module must be inside the project root' }] };
        }
        // Custom namespace IDs appear in bundled comments and initializer names.
        // Keep filesystem prefixes only in private build metadata, not module IDs.
        return { path: modulePath.split(sep).join('/'), namespace: 'native-wasm',
          pluginData: { wasmFile: resolved.path } };
      });
      build.onLoad({ filter: /.*/, namespace: 'native-wasm' }, async args => {
        const wasmFile = args.pluginData?.wasmFile;
        if (typeof wasmFile !== 'string' || !isAbsolute(wasmFile)) throw new Error('Native WASM filesystem resolution is missing');
        const { module, location } = await nativeAsset(wasmFile);
        const modules = [...new Set(WebAssembly.Module.imports(module).map(item => item.module))];
        const exports = WebAssembly.Module.exports(module);
        // Preserve the real binary's imports and exports. Missing JS glue fails
        // resolution instead of supplying invented implementations or objects.
        const imports = modules.map((name, i) => `import * as nativeImport${i} from ${JSON.stringify(name)};`).join('\n');
        const importObject = modules.map((name, i) => `[${JSON.stringify(name)}]: nativeImport${i}`).join(', ');
        const bindings = exports.map(({ name }, i) =>
          `const nativeExport${i} = nativeInstance.exports[${JSON.stringify(name)}];\nexport { nativeExport${i} as ${JSON.stringify(name)} };`).join('\n');
        return {
          loader: 'js', resolveDir: dirname(wasmFile), watchFiles: [wasmFile],
          contents: `${imports}\nconst nativeResponse = await fetch(new URL(${JSON.stringify(`./${location}`)}, import.meta.url));
if (!nativeResponse.ok) throw new Error('Native WASM asset could not be loaded');
const { instance: nativeInstance } = await WebAssembly.instantiate(await nativeResponse.arrayBuffer(), { ${importObject} });
${bindings}\n`,
        };
      });
      // wasm-bindgen's web target may fetch a literal URL instead of importing
      // WASM as ESM. Copy those real bytes and preserve its own initialization.
      build.onLoad({ filter: /\.[cm]?js$/, namespace: 'file' }, async args => {
        const input = await readFile(args.path, 'utf8');
        const pattern = /new URL\(\s*(['"])([^'"\r\n]+\.wasm)\1\s*,\s*import\.meta\.url\s*\)/g;
        const matches = [...input.matchAll(pattern)];
        if (!matches.length) return;
        let output = input;
        for (const match of matches.reverse()) {
          if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(match[2]) || /^[\\/]/.test(match[2])) {
            throw new Error('Native WASM URL must reference a local package asset');
          }
          const { location } = await nativeAsset(resolve(dirname(args.path), match[2]));
          output = output.slice(0, match.index) + `new URL(${JSON.stringify(`./${location}`)}, import.meta.url)`
            + output.slice(match.index + match[0].length);
        }
        return { contents: output, loader: 'js', resolveDir: dirname(args.path) };
      });
    },
  };
}

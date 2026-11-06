import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const input = resolve(root, 'contracts/donations.compact');
const output = resolve(root, 'contracts/managed/donations');
const flags = process.argv.includes('--skip-zk') ? ['--skip-zk'] : [];
mkdirSync(output, { recursive: true });
const linuxPath = path => path.replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`).replaceAll('\\', '/');
let command, args;
if (process.platform === 'win32') {
  const compiler = process.env.COMPACTC ?? resolve(root, '../.tools/compact/versions/0.31.1/x86_64-unknown-linux-musl/compactc');
  if (!existsSync(compiler)) throw new Error('Compact 0.31.1 compiler missing. Set COMPACTC to its path.');
  command = 'wsl.exe';
  args = ['-d', process.env.WSL_DISTRO ?? 'Ubuntu-24.04', '--cd', linuxPath(dirname(compiler)), '--', './compactc', ...flags, linuxPath(input), linuxPath(output)];
} else if (process.env.COMPACTC) {
  command = process.env.COMPACTC; args = [...flags, input, output];
} else {
  command = 'compact'; args = ['compile', '+0.31.1', ...flags, input, output];
}
const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

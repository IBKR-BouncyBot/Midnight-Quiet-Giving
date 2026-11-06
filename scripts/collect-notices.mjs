import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export async function collectNotices(root, dist, inputs) {
  const packages = new Map();
  for (const name of inputs) {
    if (!name.includes('node_modules/') || name.startsWith('native-wasm:')) continue;
    let dir = dirname(resolve(root, name));
    while (dir !== root && dir !== dirname(dir)) {
      const manifest = join(dir, 'package.json');
      if (await stat(manifest).catch(() => false)) {
        const pkg = JSON.parse(await readFile(manifest, 'utf8'));
        if (pkg.name) { packages.set(pkg.name, { pkg, dir }); break; }
      }
      dir = dirname(dir);
    }
  }
  const sections = ['Third-party software included in the Private Donations browser bundle.\nProject-owned source uses the license supplied in LICENSE.\n'];
  for (const { pkg, dir } of [...packages.values()].sort((a,b) => a.pkg.name.localeCompare(b.pkg.name))) {
    const files = (await readdir(dir)).filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name));
    sections.push(`\n${'='.repeat(72)}\n${pkg.name} ${pkg.version}\nLicense: ${typeof pkg.license === 'string' ? pkg.license : 'See upstream package notices'}\n`);
    for (const name of files) if ((await stat(join(dir, name))).isFile()) sections.push(`\n${name}\n${await readFile(join(dir,name),'utf8')}\n`);
    if (!files.length) sections.push(`License information: https://www.npmjs.com/package/${pkg.name}\n`);
  }
  await writeFile(join(dist, 'THIRD_PARTY_NOTICES.txt'), sections.join('\n'));
}

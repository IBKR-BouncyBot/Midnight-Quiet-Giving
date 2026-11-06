import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, relative, sep } from 'node:path';

export function createStaticServer({ directory = resolve(import.meta.dirname, '../dist'), port = 4180, prefix = '' } = {}) {
  const root = resolve(directory);
  return createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (prefix) {
        if (!pathname.startsWith(prefix)) { res.writeHead(404).end('Not found'); return; }
        pathname = pathname.slice(prefix.length);
      }
      let file = resolve(root, `.${pathname.startsWith('/') ? pathname : '/' + pathname}`);
      const rel = relative(root, file);
      if (rel === '..' || rel.startsWith(`..${sep}`)) { res.writeHead(403).end('Forbidden'); return; }
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(await readFile(file));
    } catch { res.writeHead(404).end('Not found'); }
  }).listen(port, '127.0.0.1');
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const port = Number(process.env.PORT ?? 4180);
  const server = createStaticServer({ port });
  server.on('listening', () => console.log(`Quiet Giving: http://127.0.0.1:${port}`));
}

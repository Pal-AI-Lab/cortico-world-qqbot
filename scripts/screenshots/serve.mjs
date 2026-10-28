// Static server for the screenshot harness: ES modules do not load from file://.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'page.html';
  try {
    const body = await readFile(join(dir, path));
    res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(8977, '127.0.0.1', () => console.log('http://127.0.0.1:8977/page.html'));

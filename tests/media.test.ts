import { afterEach, describe, expect, it } from 'vitest';
import { readAttachment } from '../src/media.ts';
import { httpServer } from './helpers.ts';

let server: Awaited<ReturnType<typeof httpServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });
const options = () => ({ maxBytes: 8, timeoutMs: 1000, signal: new AbortController().signal, testOrigin: server?.url });

describe('attachment transport', () => {
  it('rejects private, credential-bearing and deceptive hosts before making a request', async () => {
    const urls = ['http://qpic.cn/a', 'https://127.0.0.1/a', 'https://qpic.cn.example.invalid/a', 'https://user:password@qpic.cn/a', 'https://qpic.cn:8080/a'];
    for (const url of urls) await expect(readAttachment(url, options())).rejects.toThrow('outside');
  });

  it('follows CDN redirects and refuses redirects to a private host', async () => {
    server = await httpServer((req, res) => {
      if (req.url === '/image') { res.writeHead(200, { 'Content-Type': 'image/png; charset=binary' }); res.end('image'); }
      else { res.writeHead(302, { Location: req.url === '/safe' ? 'https://qpic.cn/image' : 'https://127.0.0.1/private' }); res.end(); }
    });
    expect(await readAttachment('https://qpic.cn/safe', options())).toEqual({ bytes: Buffer.from('image'), mime: 'image/png' });
    await expect(readAttachment('https://qpic.cn/unsafe', options())).rejects.toThrow('outside');
  });

  it('enforces size limits for declared and chunked bodies and bounds redirect loops', async () => {
    server = await httpServer((req, res) => {
      if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); res.end(); }
      else if (req.url === '/declared') { res.writeHead(200, { 'Content-Length': '9' }); res.end('123456789'); }
      else { res.writeHead(200); res.write('12345'); res.end('6789'); }
    });
    for (const path of ['/declared', '/chunked']) await expect(readAttachment(`https://qpic.cn${path}`, options())).rejects.toThrow('maxMediaBytes');
    await expect(readAttachment('https://qpic.cn/loop', options())).rejects.toThrow('Too many');
  });
});

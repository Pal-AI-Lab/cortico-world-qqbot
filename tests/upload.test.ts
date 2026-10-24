import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { QQOfficialClient } from '../src/client.ts';
import { QQUploader } from '../src/upload.ts';
import { httpServer, json, readBody, SECRET } from './helpers.ts';

const close: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(close.splice(0).map(f => f())); });
const digest = (bytes: Uint8Array, algorithm: string) => createHash(algorithm).update(bytes).digest('hex');
const data = Buffer.alloc(5 * 1024 * 1024 + 123, 7);
const signal = () => new AbortController().signal;

describe('QQ large file transfer', () => {
  it.each([0, 1])('uploads every byte with %i-based part indexes, checksums, merge and TTL caching', async first => {
    const uploaded: Buffer[] = [];
    let prepare = 0; let finish = 0; let merge = 0;
    const size = 2 * 1024 * 1024;
    const server = await httpServer(async (req, res) => {
      if (req.url === '/token') { json(res, { access_token: 'token', expires_in: 7200 }); return; }
      if (req.method === 'PUT') {
        expect(req.headers.authorization).toBeUndefined(); expect(req.headers['x-union-appid']).toBeUndefined();
        const parts: Buffer[] = []; for await (const part of req) parts.push(part);
        uploaded.push(Buffer.concat(parts)); res.writeHead(200).end(); return;
      }
      const body = await readBody(req);
      if (req.url!.endsWith('upload_prepare')) {
        prepare++;
        expect(body).toMatchObject({ md5: digest(data, 'md5'), sha1: digest(data, 'sha1'), md5_10m: digest(data, 'md5'), file_size: String(data.length), file_type: 4 });
        json(res, { data: { upload_id: 'upload', block_size: size,
          parts: [2, 0, 1].map(i => ({ index: i + first, presigned_url: `${server.url}/part-${i}` })) } });
      } else if (req.url!.endsWith('upload_part_finish')) {
        const bytes = data.subarray(finish * size, Math.min((finish + 1) * size, data.length));
        expect(body).toEqual({ upload_id: 'upload', part_index: finish + first, block_size: String(bytes.length), md5: digest(bytes, 'md5') });
        finish++; json(res, {});
      } else {
        merge++; expect(finish).toBe(3); expect(body).toMatchObject({ upload_id: 'upload', srv_send_msg: false });
        json(res, { data: { file_info: 'merged', file_uuid: 'uuid', ttl: 60 } });
      }
    }); close.push(() => server.close());
    const client = new QQOfficialClient({ appId: 'app', secret: SECRET, timeoutMs: 10000, apiUrl: server.url, tokenUrl: `${server.url}/token` });
    const uploader = new QQUploader(client, 10000, server.url);
    const target = { kind: 'group' as const, id: 'group' };
    expect(await uploader.upload(target, 4, { bytes: data, name: 'large.bin' }, signal())).toBe('merged');
    expect(Buffer.concat(uploaded)).toEqual(data);
    expect(await uploader.upload(target, 4, { bytes: data, name: 'large.bin' }, signal())).toBe('merged');
    expect([prepare, finish, merge]).toEqual([1, 3, 1]);
  });

  it.each(['gap', 'private-url', 'quota'])('does not send file bytes or a message for %s', async mode => {
    let calls = 0;
    const server = await httpServer((req, res) => {
      if (req.url === '/token') { json(res, { access_token: 'token', expires_in: 7200 }); return; }
      calls++;
      if (mode === 'quota') { json(res, { code: 40093002 }, 403); return; }
      json(res, { upload_id: 'u', block_size: data.length,
        parts: [{ index: mode === 'gap' ? 2 : 0, presigned_url: 'https://127.0.0.1/upload' }] });
    }); close.push(() => server.close());
    const client = new QQOfficialClient({ appId: 'app', secret: SECRET, timeoutMs: 1000, apiUrl: server.url, tokenUrl: `${server.url}/token` });
    await expect(new QQUploader(client, 1000).upload({ kind: 'c2c', id: 'user' }, 4, { bytes: data, name: 'large.bin' }, signal())).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('cancels after a part without merging or sending a message', async () => {
    const controller = new AbortController(); let merge = 0;
    const server = await httpServer((req, res) => {
      if (req.url === '/token') { json(res, { access_token: 'token', expires_in: 7200 }); return; }
      if (req.method === 'PUT') { req.resume(); controller.abort(); res.writeHead(200).end(); return; }
      if (req.url!.endsWith('/files')) { merge++; json(res, {}); return; }
      json(res, { upload_id: 'u', block_size: data.length, parts: [{ index: 0, presigned_url: `${server.url}/part` }] });
    }); close.push(() => server.close());
    const client = new QQOfficialClient({ appId: 'app', secret: SECRET, timeoutMs: 1000, apiUrl: server.url, tokenUrl: `${server.url}/token` });
    await expect(new QQUploader(client, 1000, server.url).upload({ kind: 'c2c', id: 'user' }, 4, { bytes: data, name: 'large.bin' }, controller.signal)).rejects.toThrow();
    expect(merge).toBe(0);
  });
});

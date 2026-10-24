import { createHash } from 'node:crypto';
import { QQOfficialApiError, type QQOfficialClient } from './client.ts';
import { waitUntil } from './delivery.ts';
import { object, route, string, type JsonObject, type QQOfficialTarget } from './protocol.ts';

const CHUNK_THRESHOLD = 5 * 1024 * 1024;
const hash = (data: Uint8Array, algorithm: string) => createHash(algorithm).update(data).digest('hex');
const unwrap = (response: JsonObject): JsonObject => response.data && typeof response.data === 'object' ? object(response.data) : response;
export const MEDIA_LIMITS = [0, 30, 100, 20, 100].map(mib => mib * 1024 * 1024);

/** File transfers never send a message themselves; only the final World send can do so. */
export class QQUploader {
  private cache = new Map<string, { expires: number; info: string }>();
  constructor(private readonly client: QQOfficialClient, private readonly timeoutMs: number, private readonly testOrigin?: string) {}

  private async api(path: string, payload: JsonObject, signal: AbortSignal): Promise<JsonObject> {
    for (let attempt = 0; ; attempt++) {
      try { return unwrap(await this.client.request('POST', path, payload, signal)); }
      catch (error) {
        if (!(error instanceof QQOfficialApiError) || !error.rejected || error.kind !== 'upload' || attempt >= 2) throw error;
        await waitUntil(Date.now() + 1000 * (attempt + 1), signal);
      }
    }
  }

  async upload(target: QQOfficialTarget, fileType: number, source: { bytes?: Uint8Array; url?: string; name: string }, signal: AbortSignal): Promise<string> {
    const base = route(target);
    const { bytes, url, name } = source;
    if (bytes && (!bytes.length || bytes.length > MEDIA_LIMITS[fileType])) throw new Error('Media exceeds the QQ limit for its file type');
    const key = bytes ? `${base}:${fileType}:${name}:${hash(bytes, 'sha256')}` : undefined;
    const cached = key ? this.cache.get(key) : undefined;
    if (cached && cached.expires > Date.now()) return cached.info;
    const result = bytes && bytes.length >= CHUNK_THRESHOLD
      ? await this.chunked(base, bytes, fileType, name, signal)
      : await this.api(`${base}/files`, { file_type: fileType, file_name: name, srv_send_msg: false,
        ...(bytes ? { file_data: Buffer.from(bytes).toString('base64') } : { url }) }, signal);
    const info = string(result.file_info, 'file_info');
    if (key && Number(result.ttl) > 0) {
      this.cache.delete(key);
      this.cache.set(key, { info, expires: Date.now() + Math.min(Number(result.ttl), 86400) * 1000 - 1000 });
      if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
    }
    return info;
  }

  private async chunked(base: string, bytes: Uint8Array, fileType: number, name: string, signal: AbortSignal): Promise<JsonObject> {
    const prepared = await this.api(`${base}/upload_prepare`, {
      file_type: fileType, file_name: name, file_size: String(bytes.length), md5: hash(bytes, 'md5'), sha1: hash(bytes, 'sha1'),
      md5_10m: hash(bytes.subarray(0, 10_002_432), 'md5'),
    }, signal);
    const uploadId = string(prepared.upload_id, 'upload_id');
    const blockSize = Number(prepared.block_size);
    if (!Number.isSafeInteger(blockSize) || blockSize <= 0 || !Array.isArray(prepared.parts)) throw new Error('Invalid QQ upload plan');
    const parts = prepared.parts.map(p => object(p)).sort((a, b) => Number(a.index ?? a.part_index) - Number(b.index ?? b.part_index));
    const first = Number(parts[0]?.index ?? parts[0]?.part_index);
    if (![0, 1].includes(first) || parts.length !== Math.ceil(bytes.length / blockSize)) throw new Error('Incomplete QQ upload plan');
    // Validate the whole plan before sending any file bytes to signed URLs.
    const plan = parts.map((p, i) => {
      const index = Number(p.index ?? p.part_index);
      const size = Math.min(blockSize, bytes.length - i * blockSize);
      if (index !== first + i || (p.block_size !== undefined && Number(p.block_size) !== size && Number(p.block_size) !== blockSize)) throw new Error('Invalid QQ upload part');
      const url = new URL(string(p.presigned_url, 'presigned_url'));
      const test = this.testOrigin && url.origin === this.testOrigin;
      if (!test && (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
        || !['myqcloud.com', 'qcloud.com', 'tencentcos.cn', 'qq.com'].some(d => url.hostname === d || url.hostname.endsWith(`.${d}`)))) throw new Error('QQ upload URL is outside Tencent storage');
      return { index, url, offset: i * blockSize, size };
    });
    for (const part of plan) {
      const data = bytes.subarray(part.offset, part.offset + part.size);
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        try {
          const response = await fetch(part.url, { method: 'PUT', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
            headers: { 'Content-Length': String(data.length) }, body: new Uint8Array(data) });
          await response.body?.cancel();
          if (!response.ok) throw new Error(`QQ upload part HTTP ${response.status}`);
          break;
        } catch (error) {
          signal.throwIfAborted();
          if (attempt >= 2) throw error;
          // PUT to the same signed object is idempotent; retrying cannot duplicate a chat message.
          await waitUntil(Date.now() + 500 * (attempt + 1), signal);
        }
      }
      await this.api(`${base}/upload_part_finish`, { upload_id: uploadId, part_index: part.index, block_size: String(data.length), md5: hash(data, 'md5') }, signal);
    }
    return this.api(`${base}/files`, { upload_id: uploadId, file_type: fileType, file_name: name, srv_send_msg: false }, signal);
  }
}

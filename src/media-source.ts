import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(address, prefix);
export function publicAddress(address: string): boolean {
  return isIP(address) === 4 ? !blocked.check(address, 'ipv4') : isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:db8:/i.test(address);
}

/** Handles are resolved only by the host's attachment store, never as filesystem paths. */
export function mediaBlobHandle(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected an existing log:/mem: attachment handle');
  const match = /^(log|mem):([A-Za-z0-9][A-Za-z0-9._/-]*)$/.exec(value);
  if (!match || (match[1] === 'log' && match[2].includes('/'))
    || match[2].split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Expected an existing log:/mem: attachment handle; paths and traversal are not accepted');
  }
  return value;
}

/** Public downloads used for audio conversion. DNS is pinned for each hop; no bot headers are sent. */
export async function publicMedia(url: string, maxBytes: number, timeoutMs: number, outer: AbortSignal): Promise<Uint8Array> {
  const signal = AbortSignal.any([outer, AbortSignal.timeout(timeoutMs)]);
  let current = new URL(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted();
    if (!['http:', 'https:'].includes(current.protocol) || current.username || current.password || (current.port && !['80', '443'].includes(current.port))) throw new Error('Expected a public HTTP(S) media URL');
    const hostname = current.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Media URL resolves to a non-public address');
    const chosen = addresses[0];
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = (current.protocol === 'https:' ? https : http).get(current, {
        signal,
        lookup: (_host, options, cb) => options.all ? cb(null, [chosen]) : cb(null, chosen.address, chosen.family),
      }, resolve);
      req.on('error', reject);
    });
    if ([301, 302, 303, 307, 308].includes(response.statusCode!)) {
      const location = response.headers.location; response.destroy();
      if (!location) throw new Error('Media redirect has no location');
      current = new URL(location, current); continue;
    }
    if (response.statusCode !== 200 || Number(response.headers['content-length']) > maxBytes) {
      response.destroy(); throw new Error('Media download rejected or exceeds maxMediaBytes');
    }
    const parts: Buffer[] = []; let size = 0;
    for await (const part of response) {
      size += part.length;
      if (size > maxBytes) { response.destroy(); throw new Error('Media exceeds maxMediaBytes'); }
      parts.push(part);
    }
    if (!size) throw new Error('Empty media');
    return Buffer.concat(parts);
  }
  throw new Error('Too many media redirects');
}

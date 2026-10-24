/** Attachments are fetched only from platform CDN hosts, without bot credentials. Redirects are checked again. */
export async function readAttachment(url: string, options: { maxBytes: number; timeoutMs: number; signal: AbortSignal; testOrigin?: string }) {
  let current = new URL(url.startsWith('//') ? `https:${url}` : /^[\w.-]+\.[a-z]+\//i.test(url) ? `https://${url}` : url);
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (current.protocol !== 'https:' || current.username || current.password || (current.port && current.port !== '443')
      || !['qq.com', 'qq.com.cn', 'qpic.cn', 'ugcimg.cn'].some((domain) => current.hostname === domain || current.hostname.endsWith(`.${domain}`))) {
      throw new Error('Attachment URL is outside the QQ CDN hosts');
    }
    const response = await fetch(options.testOrigin ? `${options.testOrigin}${current.pathname}${current.search}` : current.href, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Attachment redirect has no location');
      current = new URL(location, current); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Attachment HTTP ${response.status}`); }
    if (Number(response.headers.get('content-length')) > options.maxBytes) {
      await response.body?.cancel(); throw new Error('Attachment exceeds maxMediaBytes');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty attachment response');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > options.maxBytes) throw new Error('Attachment exceeds maxMediaBytes');
        chunks.push(part.value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    return { bytes: Buffer.concat(chunks), mime: response.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream' };
  }
  throw new Error('Too many attachment redirects');
}

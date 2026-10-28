import { setTimeout as delay } from 'node:timers/promises';
import { QQOfficialApiError } from './client.ts';
import type { JsonObject } from './protocol.ts';

/** Only explicit rejections are eligible: an unknown delivery result must never cause another send. */
export async function sendWithFallback(options: {
  payload: JsonObject; send(payload: JsonObject): Promise<JsonObject>; signal: AbortSignal;
  fallback: boolean; proactive(): Promise<number>; continuation?: boolean;
  /** Direct chats only: reserve a sequence for a wakeup message after a proactive message is refused. */
  wakeup?(): Promise<number>;
}): Promise<{ result: JsonObject; payload: JsonObject; fallbacks: string[] }> {
  const payload = { ...options.payload };
  const fallbacks: string[] = [];
  let rateRetries = 0;
  for (;;) {
    options.signal.throwIfAborted();
    try { return { result: await options.send(payload), payload, fallbacks }; }
    catch (error) {
      if (!(error instanceof QQOfficialApiError) || !error.rejected) throw error;
      if (error.kind === 'rate' && rateRetries < 2) {
        const seconds = Number(error.retryAfter);
        const wait = error.retryAfter ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(error.retryAfter) - Date.now()) : 1000 * 2 ** rateRetries;
        if (!Number.isFinite(wait) || wait > 5000) throw error;
        rateRetries++;
        await delay(Math.max(0, wait), undefined, { signal: options.signal });
        continue;
      }
      if (!options.fallback || options.continuation) throw error;
      if (error.kind === 'anchor' && (payload.msg_id || payload.event_id) && !fallbacks.includes('proactive')) {
        const sequence = await options.proactive();
        delete payload.msg_id; delete payload.event_id;
        if ('msg_seq' in payload) payload.msg_seq = sequence;
        fallbacks.push('proactive');
      } else if ((error.kind === 'proactive' || error.kind === 'refused') && options.wakeup && !payload.msg_id && !payload.event_id
        && !payload.is_wakeup && !fallbacks.includes('wakeup')) {
        const sequence = await options.wakeup();
        payload.is_wakeup = true;
        if ('msg_seq' in payload) payload.msg_seq = sequence;
        fallbacks.push('wakeup');
      } else if (error.kind === 'markdown' && (payload.markdown || payload.content_type === 'markdown') && !fallbacks.includes('text')) {
        if (payload.markdown) {
          payload.content = (payload.markdown as JsonObject).content;
          delete payload.markdown;
          if ('msg_type' in payload) payload.msg_type = 0;
        } else payload.content_type = 'text';
        fallbacks.push('text');
      } else if (error.kind === 'newline' && typeof payload.content_raw === 'string' && !fallbacks.includes('newline')) {
        payload.content_raw += payload.content_raw.endsWith('\n') ? '' : '\n';
        fallbacks.push('newline');
      } else throw error;
    }
  }
}

export async function waitUntil(at: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (at > Date.now()) await delay(at - Date.now(), undefined, { signal });
}

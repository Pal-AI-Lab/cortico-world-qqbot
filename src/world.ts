import { fileURLToPath } from 'node:url';
import type { Language } from 'cortico/core/language.ts';
import type { EventEnvelope, ToolDef, ToolOutcome, World, WorldWebUiDecl, WorldHost } from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';
import type { WorldContext } from 'cortico/world.ts';
import { QQOfficialBinding } from './binding.ts';
import { QQOfficialClient, QQOFFICIAL_SANDBOX_URL } from './client.ts';
import { QQOFFICIAL_ID, QQOFFICIAL_SECRET, qqOfficialConfigGroup, validateConfig, type QQOfficialConfigSection } from './config.ts';
import { QQOfficialGateway, type QQOfficialConnectionState } from './gateway.ts';
import { QQOFFICIAL_MODEL_TEXT, type ModelLanguage } from './model-text.ts';
import { readAttachment } from './media.ts';
import { normalize } from './normalize.ts';
import { integer, object, remoteUrl, route, string, target, targetKey, type JsonObject, type QQOfficialDispatch, type QQOfficialTarget } from './protocol.ts';
import { qqOfficialText } from './strings.ts';
import { qqOfficialTools, type QQOfficialAction } from './tools.ts';
import { QQOfficialWebhook } from './webhook.ts';

export interface QQOfficialWorldOptions {
  context: WorldContext<QQOfficialConfigSection>;
  modelLanguage?: () => ModelLanguage;
  /** Endpoint overrides for local protocol servers in tests. */
  endpoints?: { apiUrl?: string; tokenUrl?: string; bindingUrl?: string; mediaOrigin?: string };
}

/** QQ owns delivery semantics; Core owns event storage, batching and the Persona's decision to act. */
export class QQOfficialWorld implements World {
  readonly id = QQOFFICIAL_ID;
  private host: WorldHost | null = null;
  private client: QQOfficialClient | null = null;
  private gateway: QQOfficialGateway | null = null;
  private webhook: QQOfficialWebhook | null = null;
  private abort = new AbortController();
  private incoming = Promise.resolve();
  private outgoing = Promise.resolve<unknown>(undefined);
  private control = Promise.resolve<unknown>(undefined);
  private seen = new Set<string>();
  private appId = '';
  private state: QQOfficialConnectionState = 'offline';
  private detail = '';
  private binding: QQOfficialBinding;

  constructor(private readonly options: QQOfficialWorldOptions) {
    this.binding = new QQOfficialBinding(options.context.cfg.timeoutMs, options.endpoints?.bindingUrl);
  }

  private get cfg() { return this.options.context.cfg; }
  private get text() { return QQOFFICIAL_MODEL_TEXT[this.options.modelLanguage?.() ?? this.cfg.modelLanguage]; }

  envPromptVars(): Record<string, string> { return { 'qqofficial.environment': this.text.environment }; }

  tools(): ToolDef[] {
    return qqOfficialTools(this.options.modelLanguage?.() ?? this.cfg.modelLanguage, (action, args, signal) => {
      const task = this.outgoing.then(() => this.execute(action, args, signal));
      this.outgoing = task.catch(() => undefined);
      return task;
    });
  }

  async start(host: WorldHost): Promise<void> {
    validateConfig(this.cfg);
    this.appId = string(this.cfg.appId, 'AppID');
    const secret = string(this.options.context.secret(QQOFFICIAL_SECRET), 'AppSecret');
    this.host = host;
    this.abort = new AbortController();
    this.seen = new Set(host.store.range({ source: this.id, limit: 10000 })
      .filter((e) => e.meta?.appId === this.appId && typeof e.meta?.dedupKey === 'string').map((e) => e.meta!.dedupKey as string));
    this.client = new QQOfficialClient({
      appId: this.appId, secret, timeoutMs: this.cfg.timeoutMs, signal: this.abort.signal,
      apiUrl: this.options.endpoints?.apiUrl ?? (this.cfg.sandbox ? QQOFFICIAL_SANDBOX_URL : undefined),
      tokenUrl: this.options.endpoints?.tokenUrl,
    });
    try {
      if (this.cfg.transport === 'websocket') {
        this.gateway = new QQOfficialGateway({
          client: this.client, intents: this.cfg.intents, reconnectMs: this.cfg.reconnectMs,
          maxReconnectMs: this.cfg.maxReconnectMs, timeoutMs: this.cfg.timeoutMs,
          onEvent: (event) => this.receive(event), onState: (state, detail) => this.setState(state, detail),
        });
        this.gateway.start();
      } else {
        this.webhook = new QQOfficialWebhook({
          secret, ...this.cfg.webhook, onEvent: (event) => this.receive(event),
          onError: () => this.setState('error', 'Webhook delivery failed'),
        });
        const port = await this.webhook.start();
        this.setState('online', `${this.cfg.webhook.host}:${port}${this.cfg.webhook.path}`);
      }
    } catch (error) { await this.stop(); throw error; }
  }

  async stop(): Promise<void> {
    this.abort.abort();
    await Promise.allSettled([this.gateway?.stop(), this.webhook?.stop()]);
    await Promise.allSettled([this.incoming, this.outgoing]);
    this.gateway = null; this.webhook = null; this.client = null; this.host = null;
    this.binding.clear(); this.setState('offline');
  }

  private setState(state: QQOfficialConnectionState, detail = ''): void {
    if (state === this.state && detail === this.detail) return;
    this.state = state; this.detail = detail;
    this.host?.log.info('qqofficial.connection', { state, detail });
  }

  private receive(event: QQOfficialDispatch): Promise<void> {
    const task = this.incoming.then(async () => {
      this.abort.signal.throwIfAborted();
      const incoming = normalize(event);
      if (incoming.key && this.seen.has(incoming.key)) return;
      const { key, ...data } = incoming;
      await this.push(incoming.kind, incoming.target, data, true, key ? { dedupKey: key } : {});
      if (key) {
        this.seen.add(key);
        if (this.seen.size > 10000) this.seen.delete(this.seen.values().next().value!);
      }
    });
    this.incoming = task.catch(() => undefined);
    return task;
  }

  private sender(value?: QQOfficialTarget): string { return value ? `${this.id}.${targetKey(value)}` : this.id; }

  private push(kind: 'message' | 'notice' | 'sent' | 'attempt' | 'removed' | 'acknowledged', destination: QQOfficialTarget | undefined,
    data: JsonObject, deliver = false, extra: JsonObject = {}): Promise<EventEnvelope> {
    if (!this.host) throw new Error('World is not running');
    return this.host.pushEvent({
      type: `${this.id}.${kind}`, source: this.id, origin: 'external', ts: nowIso(this.options.context.timezone),
      senderKey: this.sender(destination), ...(kind === 'sent' ? { tags: ['speak'] as const } : {}),
      text: `${this.text[kind]}\n${JSON.stringify(data)}`,
      meta: { ...data, ...extra, target: destination, appId: this.appId },
    }, { deliver, trigger: 'debounce' });
  }

  private anchors(args: JsonObject): JsonObject {
    if (args.replyTo !== undefined && args.eventId !== undefined) throw new Error('replyTo and eventId are mutually exclusive');
    return {
      ...(args.replyTo !== undefined ? { msg_id: string(args.replyTo, 'replyTo') } : {}),
      ...(args.eventId !== undefined ? { event_id: string(args.eventId, 'eventId') } : {}),
    };
  }

  private async prepare(destination: QQOfficialTarget, anchors: JsonObject): Promise<number> {
    const events = this.host!.store.range({ source: this.id, senderKey: this.sender(destination) });
    const previous = events.filter((e) => e.type === `${this.id}.attempt` && e.meta?.appId === this.appId
      && e.meta?.msg_id === anchors.msg_id && e.meta?.event_id === anchors.event_id);
    const sequence = previous.reduce((max, e) => Math.max(max, Number(e.meta?.msg_seq) || 0), 0) + 1;
    await this.push('attempt', destination, { ...anchors, msg_seq: sequence });
    return sequence;
  }

  private async execute(action: QQOfficialAction, args: JsonObject, signal?: AbortSignal): Promise<string | ToolOutcome> {
    if (!this.host || !this.client) throw new Error('World is not running');
    const combined = AbortSignal.any([this.abort.signal, ...signal ? [signal] : []]);
    combined.throwIfAborted();
    if (action === 'read') {
      const cursor = integer(args.cursor, 'cursor', 1, Number.MAX_SAFE_INTEGER);
      const index = integer(args.index, 'index', 0, Number.MAX_SAFE_INTEGER);
      const event = this.host.store.get(cursor);
      if (event?.type !== `${this.id}.message` || event.source !== this.id || event.meta?.appId !== this.appId) throw new Error('Message event not found');
      const attachments = object(event.meta.data).attachments;
      if (!Array.isArray(attachments) || index >= attachments.length) throw new Error('Attachment not found');
      const attachment = object(attachments[index]);
      const media = await readAttachment(string(attachment.url, 'attachment.url'), {
        maxBytes: this.cfg.maxMediaBytes, timeoutMs: this.cfg.timeoutMs, signal: combined, testOrigin: this.options.endpoints?.mediaOrigin,
      });
      const text = JSON.stringify({ cursor, index, messageId: event.meta.messageId, mime: media.mime, bytes: media.bytes.byteLength });
      return { text, blobs: [{ ...media, ...(typeof attachment.filename === 'string' ? { name: attachment.filename } : {}), fallbackText: text }] };
    }
    if (action === 'history') {
      const limit = args.limit === undefined ? 30 : integer(args.limit, 'limit', 1, 100);
      const before = args.beforeCursor === undefined ? undefined : integer(args.beforeCursor, 'beforeCursor', 1, Number.MAX_SAFE_INTEGER) - 1;
      const destination = args.target === undefined ? undefined : target(args.target);
      const events = this.host.store.range({ source: this.id, ...(destination ? { senderKey: this.sender(destination) } : {}), toCursor: before });
      return JSON.stringify(events.filter((e) => e.meta?.appId === this.appId && e.type !== `${this.id}.attempt`).slice(-limit));
    }
    if (action === 'interaction') {
      const id = string(args.interactionId, 'interactionId');
      const code = integer(args.code, 'code', 0, 5);
      const result = await this.client.request('PUT', `/interactions/${encodeURIComponent(id)}`, { code }, combined);
      await this.push('acknowledged', undefined, { interactionId: id, code, result });
      return JSON.stringify(result);
    }
    const destination = target(args.target);
    if (action === 'remove') {
      const id = string(args.messageId, 'messageId');
      const result = await this.client.request('DELETE', `${route(destination)}/messages/${encodeURIComponent(id)}`, undefined, combined);
      await this.push('removed', destination, { messageId: id, result });
      return JSON.stringify(result);
    }
    let anchors = this.anchors(args);
    let payload: JsonObject;
    let suffix = 'messages';
    let streamData: JsonObject = {};
    let sequence: number | undefined;
    if (action === 'media') {
      const fileType = integer(args.fileType, 'fileType', 1, 4);
      if ((args.url !== undefined) === (args.blob !== undefined)) throw new Error('Supply exactly one of url or blob');
      if (destination.kind === 'channel' || destination.kind === 'dms') {
        if (fileType !== 1 || args.url === undefined) throw new Error('Channels and DMS accept remote images only');
        payload = { image: remoteUrl(args.url) };
      } else {
        let media: JsonObject;
        if (args.url !== undefined) media = { url: remoteUrl(args.url) };
        else {
          const handle = string(args.blob, 'blob');
          if (!/^(log|mem):/.test(handle)) throw new Error('Expected a log:/mem: blob handle');
          const blob = this.host.blob(handle);
          if (!blob) throw new Error('Blob not found');
          if (blob.bytes.byteLength > this.cfg.maxMediaBytes) throw new Error('Media exceeds maxMediaBytes');
          media = { file_data: Buffer.from(blob.bytes).toString('base64') };
        }
        const uploaded = await this.client.request('POST', `${route(destination)}/files`, {
          ...media, file_type: fileType, srv_send_msg: false,
          ...(args.fileName !== undefined ? { file_name: string(args.fileName, 'fileName') } : {}),
        }, combined);
        payload = { msg_type: 7, media: { file_info: string(uploaded.file_info, 'file_info') } };
      }
      if (args.content !== undefined) payload.content = string(args.content, 'content');
    } else {
      const content = typeof args.content === 'string' ? args.content : string(args.content, 'content');
      const format = args.format ?? 'text';
      if (format !== 'text' && format !== 'markdown') throw new Error('Invalid format');
      if (action === 'stream') {
        if (destination.kind !== 'c2c') throw new Error('Streaming requires a c2c target');
        if (args.finish !== undefined && typeof args.finish !== 'boolean') throw new Error('Invalid finish');
        const finish = args.finish !== false;
        let index = 0;
        if (args.streamId !== undefined) {
          const streamId = string(args.streamId, 'streamId');
          const prior = this.host.store.range({ source: this.id, senderKey: this.sender(destination) })
            .filter((e) => e.type === `${this.id}.sent` && e.meta?.appId === this.appId && e.meta?.streamId === streamId).at(-1)?.meta;
          if (!prior || prior.finish) throw new Error('Stream not found or already finished');
          if ((args.replyTo !== undefined && args.replyTo !== prior.msg_id) || (args.eventId !== undefined && args.eventId !== prior.event_id)
            || (args.format !== undefined && format !== prior.format)) throw new Error('Stream target, format and reply anchor must remain unchanged');
          anchors = { ...(prior.msg_id ? { msg_id: prior.msg_id } : {}), ...(prior.event_id ? { event_id: prior.event_id } : {}) };
          sequence = prior.msg_seq as number; index = (prior.index as number) + 1;
          streamData = { streamId, format: prior.format };
        }
        if (!content && !args.streamId) throw new Error('The first stream part needs content');
        streamData = { ...streamData, index, finish, format: streamData.format ?? format };
        payload = { input_mode: 'append', input_state: finish ? 10 : 1, index, content_type: streamData.format,
          content_raw: content, ...(args.streamId ? { stream_msg_id: args.streamId } : {}) };
        suffix = 'stream_messages';
      } else {
        string(content, 'content');
        payload = format === 'markdown' ? { markdown: { content } } : { content };
        if (destination.kind === 'c2c' || destination.kind === 'group') payload.msg_type = format === 'markdown' ? 2 : 0;
        if (args.referenceId !== undefined) payload.message_reference = { message_id: string(args.referenceId, 'referenceId') };
        if (args.keyboard !== undefined) payload.keyboard = object(args.keyboard);
      }
    }
    sequence ??= await this.prepare(destination, anchors);
    combined.throwIfAborted();
    if (destination.kind === 'c2c' || destination.kind === 'group') payload.msg_seq = sequence;
    Object.assign(payload, anchors);
    const result = await this.client.request('POST', `${route(destination)}/${suffix}`, payload, combined);
    const messageId = typeof result.id === 'string' ? result.id : undefined;
    if (action === 'stream') streamData.streamId = string(result.id, 'stream response id');
    const receipt = { target: destination, ...anchors, msg_seq: sequence, ...streamData, messageId, request: payload, result };
    await this.push('sent', destination, receipt);
    return `${this.text.sent}\n${JSON.stringify(receipt)}`;
  }

  webUi(language?: Language): WorldWebUiDecl {
    const t = qqOfficialText(language);
    return {
      label: 'QQ Official',
      lamps: [{ label: t.connection, state: this.state === 'connecting' ? 'loading' : this.state, hint: this.detail || t[this.state] }],
      config: [qqOfficialConfigGroup(language)],
      panels: [{ id: 'connection', title: t.credentials }],
      invoke: (panel, method, args) => {
        if (panel !== 'connection') return Promise.reject(new Error('Unknown panel'));
        const task = this.control.then(async () => {
          if (method === 'state') return { appId: this.cfg.appId, secretSet: !!this.options.context.secret(QQOFFICIAL_SECRET), text: t };
          if (method === 'bind') return this.binding.start();
          if (method === 'poll') {
            const result = await this.binding.poll();
            if (result.kind !== 'bound') return { kind: result.kind, message: t[result.kind] };
            this.saveCredentials(result.appId, result.secret);
            this.binding.clear();
            return { kind: 'bound', message: t.saved };
          }
          if (method === 'save') {
            const data = object(args[0]);
            this.saveCredentials(string(data.appId, 'AppID'), typeof data.secret === 'string' ? data.secret : '');
            return { message: t.saved };
          }
          throw new Error('Unknown method');
        });
        this.control = task.catch(() => undefined);
        return task;
      },
      promptDocs: [{ key: 'worlds.qqofficial.envPrompt', title: t.promptTitle, description: t.promptDescription,
        role: 'envPrompt', path: fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url)),
        vars: [{ name: 'qqofficial.environment', description: t.promptDescription, multiline: true }] }],
    };
  }

  private saveCredentials(appId: string, secret: string): void {
    if (/[\r\n]/.test(appId + secret)) throw new Error('Credentials must occupy one line');
    if (!secret && (appId !== this.cfg.appId || !this.options.context.secret(QQOFFICIAL_SECRET))) throw new Error('AppSecret required');
    if (secret) this.options.context.storeSecret(QQOFFICIAL_SECRET, secret);
    this.options.context.persist({ appId });
  }
}

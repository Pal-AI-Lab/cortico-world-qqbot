import type { OutputTap } from 'cortico/core/types.ts';

/** One explicitly selected QQ reply consumes one model round's public text, never reasoning or tool arguments. */
export class QQReplyStream {
  private buffer = '';
  private timer?: ReturnType<typeof setTimeout>;
  private chain = Promise.resolve();
  private closing = false;
  private failed = false;
  private emitted = false;
  private lastAt = 0;
  private idle?: ReturnType<typeof setTimeout>;
  constructor(private readonly options: {
    intervalMs: number; idleMs: number;
    send(delta: string, finish: boolean): Promise<void>;
    error(error: unknown): void;
  }) {}

  readonly tap: OutputTap = {
    onEvent: event => {
      if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') this.append(event.delta);
      else if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') void this.finish();
      else if (event.type === 'response.failed' || event.type === 'error') void this.finish();
    },
    externalizes: event => !this.closing && (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta'),
    onRoundEnd: () => { void this.finish(); },
    onAbort: () => { void this.finish(); },
  };

  private touch(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => { void this.finish(); }, this.options.idleMs);
    this.idle.unref?.();
  }
  private append(text: string): void {
    if (this.closing || this.failed) return;
    if (this.buffer.length + text.length > 64000) { this.failed = true; this.options.error(new Error('QQ reply stream exceeds 64000 buffered characters')); void this.finish(); return; }
    this.buffer += text; this.touch();
    if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; this.flush(false); }, Math.max(0, this.lastAt + this.options.intervalMs - Date.now()));
  }
  private flush(finish: boolean): void {
    const text = this.buffer; this.buffer = '';
    if (!text && !finish) return;
    this.lastAt = Date.now();
    this.chain = this.chain.then(async () => {
      if (this.failed || (!text && !this.emitted)) return;
      await this.options.send(text, finish); this.emitted = true;
    }).catch(error => { this.failed = true; this.options.error(error); });
  }
  finish(): Promise<void> {
    if (!this.closing) {
      this.closing = true; clearTimeout(this.timer); clearTimeout(this.idle); this.flush(true);
    }
    return this.chain;
  }
  /** Used when the World stops: discard unsent text and cancel timers. The transport is aborted separately. */
  cancel(): void { this.closing = true; this.failed = true; this.buffer = ''; clearTimeout(this.timer); clearTimeout(this.idle); }
  get closed(): boolean { return this.closing; }
}

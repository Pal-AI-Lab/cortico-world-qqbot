import type { EventEnvelope } from 'cortico/core/types.ts';
import { targetKey, type JsonObject, type QQOfficialTarget } from './protocol.ts';

export interface SessionTarget {
  target: QQOfficialTarget;
  label?: string;
  lastSeen: string;
  lastMessageId?: string;
  messageAt?: number;
  proactive: 'unknown' | 'allowed' | 'blocked';
}

/** Rebuilt once from durable events. Sending does not rescan the archive. */
export class QQSessionState {
  readonly targets = new Map<string, SessionTarget>();
  private sequences = new Map<string, number>();
  private key(target: QQOfficialTarget, anchors: JsonObject): string {
    return JSON.stringify([targetKey(target), anchors.msg_id ?? null, anchors.event_id ?? null, anchors.is_wakeup === true]);
  }
  sequence(target: QQOfficialTarget, anchors: JsonObject): number { return this.sequences.get(this.key(target, anchors)) ?? 0; }
  observe(event: EventEnvelope): void {
    const meta = event.meta;
    const target = meta?.target as QQOfficialTarget | undefined;
    if (!target) return;
    if (event.type === 'qqofficial.attempt') {
      const key = this.key(target, meta!);
      this.sequences.set(key, Math.max(this.sequences.get(key) ?? 0, Number(meta!.msg_seq) || 0));
      return;
    }
    if (!['qqofficial.message', 'qqofficial.notice'].includes(event.type)) return;
    const key = targetKey(target);
    const session = this.targets.get(key) ?? { target, lastSeen: event.ts, proactive: 'unknown' as const };
    const data = meta?.data as JsonObject | undefined;
    session.lastSeen = event.ts;
    const label = data?.group_name ?? data?.channel_name ?? (data?.author as JsonObject | undefined)?.username;
    if (typeof label === 'string') session.label = label;
    if (event.type === 'qqofficial.message' && typeof meta?.messageId === 'string') {
      session.lastMessageId = meta.messageId;
      const at = typeof data?.timestamp === 'string' ? Date.parse(data.timestamp) : NaN;
      session.messageAt = Number.isFinite(at) ? Math.min(at, Date.parse(event.ts)) : Date.parse(event.ts);
    }
    const type = String(meta?.eventType);
    if (['C2C_MSG_REJECT', 'GROUP_MSG_REJECT', 'FRIEND_DEL', 'GROUP_DEL_ROBOT'].includes(type)) session.proactive = 'blocked';
    if (['C2C_MSG_RECEIVE', 'GROUP_MSG_RECEIVE', 'FRIEND_ADD', 'GROUP_ADD_ROBOT'].includes(type)) session.proactive = 'allowed';
    this.targets.set(key, session);
  }
  recentReply(target: QQOfficialTarget): string | undefined {
    const s = this.targets.get(targetKey(target));
    // A conservative 5-minute window also covers the stricter endpoint-specific contract.
    const limit = target.kind === 'c2c' ? 4 : 5;
    return s?.lastMessageId && s.messageAt && Date.now() - s.messageAt < 285000
      && this.sequence(target, { msg_id: s.lastMessageId }) < limit ? s.lastMessageId : undefined;
  }
  assertProactive(target: QQOfficialTarget): void {
    if (this.targets.get(targetKey(target))?.proactive === 'blocked') {
      throw new Error('QQ proactive messages are disabled for this target; wait for a user reply or enable Allow proactive messages in QQ');
    }
  }
  list(limit: number): Array<SessionTarget & { replyAvailable: boolean }> {
    return [...this.targets.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)).slice(0, limit)
      .map(s => ({ ...s, replyAvailable: !!this.recentReply(s.target) }));
  }
}

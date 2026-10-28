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

/**
 * How many replies one incoming message allows, and for how long. QQ documents 60 minutes and 4 replies for
 * C2C, 5 minutes and 5 replies for groups and channels (bot.q.qq.com/wiki/develop/api-v2/server-inter/message/overview.html).
 * A direct-chat reply 31 minutes later was confirmed on a phone; 30 minutes is the window chosen as safe.
 * Groups and channels keep a margin under 5 minutes.
 */
export function replyRule(kind: QQOfficialTarget['kind']): { limit: number; windowMs: number } {
  return kind === 'c2c' ? { limit: 4, windowMs: 30 * 60_000 } : { limit: 5, windowMs: 285_000 };
}

/** Rebuilt once from durable events. Sending does not rescan the archive. */
export class QQSessionState {
  readonly targets = new Map<string, SessionTarget>();
  private sequences = new Map<string, number>();
  private arrivals = new Map<string, number>();
  private key(target: QQOfficialTarget, anchors: JsonObject): string {
    return JSON.stringify([targetKey(target), anchors.msg_id ?? null, anchors.event_id ?? null, anchors.is_wakeup === true]);
  }
  sequence(target: QQOfficialTarget, anchors: JsonObject): number { return this.sequences.get(this.key(target, anchors)) ?? 0; }
  observe(event: EventEnvelope): void {
    const meta = event.meta;
    const target = meta?.target as QQOfficialTarget | undefined;
    if (!target) return;
    if (event.type === 'qqbot.attempt') {
      const key = this.key(target, meta!);
      this.sequences.set(key, Math.max(this.sequences.get(key) ?? 0, Number(meta!.msg_seq) || 0));
      return;
    }
    if (!['qqbot.message', 'qqbot.notice'].includes(event.type)) return;
    const key = targetKey(target);
    const session = this.targets.get(key) ?? { target, lastSeen: event.ts, proactive: 'unknown' as const };
    const data = meta?.data as JsonObject | undefined;
    session.lastSeen = event.ts;
    const label = data?.group_name ?? data?.channel_name ?? (data?.author as JsonObject | undefined)?.username;
    if (typeof label === 'string') session.label = label;
    if (event.type === 'qqbot.message' && typeof meta?.messageId === 'string') {
      session.lastMessageId = meta.messageId;
      const at = typeof data?.timestamp === 'string' ? Date.parse(data.timestamp) : NaN;
      session.messageAt = Number.isFinite(at) ? Math.min(at, Date.parse(event.ts)) : Date.parse(event.ts);
      this.arrivals.set(meta.messageId, session.messageAt);
    }
    const type = String(meta?.eventType);
    if (['C2C_MSG_REJECT', 'GROUP_MSG_REJECT', 'FRIEND_DEL', 'GROUP_DEL_ROBOT'].includes(type)) session.proactive = 'blocked';
    if (['C2C_MSG_RECEIVE', 'GROUP_MSG_RECEIVE', 'FRIEND_ADD', 'GROUP_ADD_ROBOT'].includes(type)) session.proactive = 'allowed';
    this.targets.set(key, session);
  }
  recentReply(target: QQOfficialTarget): string | undefined {
    const s = this.targets.get(targetKey(target));
    if (!s?.lastMessageId) return undefined;
    const budget = this.budget(target, s.lastMessageId);
    return budget && budget.left > 0 && budget.msLeft > 0 ? s.lastMessageId : undefined;
  }
  /** Replies left on one incoming message; undefined for a message this account never received. */
  budget(target: QQOfficialTarget, messageId: string): { left: number; msLeft: number } | undefined {
    const at = this.arrivals.get(messageId);
    if (at === undefined) return undefined;
    const { limit, windowMs } = replyRule(target.kind);
    return { left: Math.max(0, limit - this.sequence(target, { msg_id: messageId })), msLeft: Math.max(0, windowMs - (Date.now() - at)) };
  }
  proactiveBlocked(target: QQOfficialTarget): boolean { return this.targets.get(targetKey(target))?.proactive === 'blocked'; }
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

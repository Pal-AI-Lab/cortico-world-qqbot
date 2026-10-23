export type JsonObject = Record<string, unknown>;
export type QQOfficialTargetKind = 'c2c' | 'group' | 'channel' | 'dms';
export interface QQOfficialTarget { kind: QQOfficialTargetKind; id: string }
export interface QQOfficialDispatch { op: 0; t: string; d: JsonObject; id?: string; s?: number }

export function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as JsonObject;
}

export function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing or invalid ${field}`);
  return value;
}

export function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${field}`);
  return value;
}

export function target(value: unknown): QQOfficialTarget {
  const data = object(value);
  if (!['c2c', 'group', 'channel', 'dms'].includes(String(data.kind))) throw new Error('Invalid target kind');
  return { kind: data.kind as QQOfficialTargetKind, id: string(data.id, 'target.id') };
}

export function targetKey(value: QQOfficialTarget): string {
  return `${value.kind}:${value.id}`;
}

export function route(value: QQOfficialTarget): string {
  const prefix = { c2c: '/v2/users', group: '/v2/groups', channel: '/channels', dms: '/dms' }[value.kind];
  return `${prefix}/${encodeURIComponent(value.id)}`;
}

export function remoteUrl(value: unknown): string {
  const url = new URL(string(value, 'url'));
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Expected an HTTP(S) URL without credentials');
  return url.href;
}

export function dispatch(value: unknown): QQOfficialDispatch {
  const data = object(value);
  if (data.op !== 0) throw new Error('Expected a dispatch');
  return { op: 0, t: string(data.t, 't'), d: object(data.d),
    ...(typeof data.id === 'string' ? { id: data.id } : {}),
    ...(Number.isSafeInteger(data.s) ? { s: data.s as number } : {}) };
}

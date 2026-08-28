import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import type {
  OperationsHomeAttentionItem,
  OperationsHomeResponse,
  OperationsHomeService,
  OperationsHomeStatus,
  OperationsHomeStatusView,
  OperationsHomeWorkItem,
  OperationsHomeWorkOutcome,
} from 'gas-city-dashboard-shared';

export interface OperationsHomeReaderOptions {
  snapshotPath: string;
  expectedUid: number;
  expectedMode: number;
  maxAgeSeconds: number;
  maxBytes: number;
  now?: () => number;
}

const STATUSES = new Set<OperationsHomeStatus>(['ready', 'blocked', 'failed', 'stale', 'unknown']);
const STATUS_PRESENTATION: Record<OperationsHomeStatus, { icon: string; label: string }> = {
  ready: { icon: '+', label: 'Ready' },
  blocked: { icon: '!', label: 'Blocked' },
  failed: { icon: 'x', label: 'Failed' },
  stale: { icon: '~', label: 'Stale' },
  unknown: { icon: '?', label: 'Unknown' },
};
const ATTENTION_KINDS = new Set(['service', 'readiness', 'workstream']);
const WORK_OUTCOMES = new Set<OperationsHomeWorkOutcome>([
  'active',
  'waiting',
  'blocked',
  'failed',
  'completed',
  'stalled',
  'unknown',
]);
const PUBLIC_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function unavailable(
  reason: Extract<OperationsHomeResponse, { availability: 'unavailable' }>['reason'],
): OperationsHomeResponse {
  return { availability: 'unavailable', reason, controls: [] };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : null;
}

function statusView(value: unknown): OperationsHomeStatusView | null {
  const item = record(value);
  const status = item?.status;
  const icon = text(item?.icon);
  const label = text(item?.label);
  if (
    typeof status !== 'string' ||
    !STATUSES.has(status as OperationsHomeStatus) ||
    icon === null ||
    label === null
  )
    return null;
  const normalized = status as OperationsHomeStatus;
  const expected = STATUS_PRESENTATION[normalized];
  if (icon !== expected.icon || label !== expected.label) return null;
  return { status: normalized, ...expected };
}

function nullableCount(value: unknown): number | null | undefined {
  if (value === null) return null;
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nullablePublicReference(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' && PUBLIC_REFERENCE.test(value) ? value : undefined;
}

function workItem(value: unknown): OperationsHomeWorkItem | null {
  const item = record(value);
  const workId = text(item?.workId);
  const displayId = text(item?.displayId);
  const outcome = item?.outcome;
  const lastProgressAt = nullableNumber(item?.lastProgressAt);
  const lastProgressLabel = text(item?.lastProgressLabel);
  const receiptCount = nullableCount(item?.receiptCount);
  const laneId = nullablePublicReference(item?.laneId);
  const beadId = nullablePublicReference(item?.beadId);
  const attemptRef = nullablePublicReference(item?.attemptRef);
  const sessionRef = nullablePublicReference(item?.sessionRef);
  const agentRef = nullablePublicReference(item?.agentRef);
  if (
    workId === null ||
    displayId === null ||
    typeof outcome !== 'string' ||
    !WORK_OUTCOMES.has(outcome as OperationsHomeWorkOutcome) ||
    lastProgressAt === undefined ||
    lastProgressLabel === null ||
    receiptCount === undefined ||
    laneId === undefined ||
    beadId === undefined ||
    attemptRef === undefined ||
    sessionRef === undefined ||
    agentRef === undefined
  )
    return null;
  return {
    workId,
    displayId,
    outcome: outcome as OperationsHomeWorkOutcome,
    lastProgressAt,
    lastProgressLabel,
    receiptCount,
    laneId,
    beadId,
    attemptRef,
    sessionRef,
    agentRef,
  };
}

function project(raw: unknown, nowSeconds: number, maxAgeSeconds: number): OperationsHomeResponse {
  const root = record(raw);
  if (root === null || root.schemaVersion !== 1 || root.mode !== 'read-only')
    return unavailable('snapshot-invalid');
  const controls = root.controls;
  if (!Array.isArray(controls) || controls.length !== 0) return unavailable('snapshot-invalid');
  const generatedAt = root.generatedAt;
  if (typeof generatedAt !== 'number' || !Number.isFinite(generatedAt) || generatedAt > nowSeconds)
    return unavailable('snapshot-invalid');
  if (nowSeconds - generatedAt > maxAgeSeconds) return unavailable('snapshot-stale');
  const overall = statusView(root.overall);
  const work = record(root.work);
  const capacity = record(work?.capacity);
  const active = nullableCount(work?.active);
  const inFlight = nullableCount(work?.inFlight);
  const reported = nullableCount(work?.reported);
  const capacityLabel = text(capacity?.label);
  if (
    overall === null ||
    work === null ||
    typeof work.countsTrusted !== 'boolean' ||
    active === undefined ||
    inFlight === undefined ||
    reported === undefined ||
    capacityLabel === null
  )
    return unavailable('snapshot-invalid');
  if (work.countsTrusted === false && (active !== null || inFlight !== null || reported !== null)) {
    return unavailable('snapshot-invalid');
  }
  if (!Array.isArray(work.items)) return unavailable('snapshot-invalid');
  const items: OperationsHomeWorkItem[] = [];
  for (const value of work.items) {
    const item = workItem(value);
    if (item === null) return unavailable('snapshot-invalid');
    items.push(item);
  }

  if (!Array.isArray(root.needsAttention) || !Array.isArray(root.services))
    return unavailable('snapshot-invalid');
  const needsAttention: OperationsHomeAttentionItem[] = [];
  for (const value of root.needsAttention) {
    const item = record(value);
    const view = statusView(value);
    const kind = item?.kind;
    const id = text(item?.id);
    const title = text(item?.title);
    const explanation = text(item?.explanation);
    if (
      view === null ||
      typeof kind !== 'string' ||
      !ATTENTION_KINDS.has(kind) ||
      id === null ||
      title === null ||
      explanation === null
    )
      return unavailable('snapshot-invalid');
    needsAttention.push({
      ...view,
      kind: kind as OperationsHomeAttentionItem['kind'],
      id,
      title,
      explanation,
    });
  }
  const services: OperationsHomeService[] = [];
  for (const value of root.services) {
    const item = record(value);
    const view = statusView(value);
    const source = text(item?.source);
    const title = text(item?.title);
    const explanation = text(item?.explanation);
    const freshness = record(item?.freshness);
    const freshnessLabel = text(freshness?.label);
    if (
      view === null ||
      source === null ||
      title === null ||
      explanation === null ||
      freshnessLabel === null
    )
      return unavailable('snapshot-invalid');
    services.push({ ...view, source, title, explanation, freshnessLabel });
  }
  return {
    availability: 'available',
    schemaVersion: 1,
    mode: 'read-only',
    generatedAt,
    overall,
    needsAttention,
    work: { countsTrusted: work.countsTrusted, active, inFlight, reported, capacityLabel, items },
    services,
    controls: [],
  };
}

export async function readOperationsHomeSnapshot(
  options: OperationsHomeReaderOptions,
): Promise<OperationsHomeResponse> {
  let handle: fs.FileHandle | undefined;
  try {
    const parent = await fs.realpath(path.dirname(options.snapshotPath));
    if (parent !== path.dirname(options.snapshotPath)) return unavailable('snapshot-unavailable');
    // Node/libuv opens descriptors close-on-exec; O_NOFOLLOW is the explicit
    // boundary needed here to reject a swapped or operator-misconfigured leaf.
    handle = await fs.open(options.snapshotPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== options.expectedUid ||
      (metadata.mode & 0o777) !== options.expectedMode ||
      metadata.size > options.maxBytes
    )
      return unavailable('snapshot-unavailable');
    const raw = await handle.readFile({ encoding: 'utf8' });
    const after = await handle.stat();
    if (
      after.dev !== metadata.dev ||
      after.ino !== metadata.ino ||
      after.size !== metadata.size ||
      after.mtimeMs !== metadata.mtimeMs
    )
      return unavailable('snapshot-unavailable');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return unavailable('snapshot-invalid');
    }
    return project(parsed, (options.now ?? (() => Date.now() / 1000))(), options.maxAgeSeconds);
  } catch {
    return unavailable('snapshot-unavailable');
  } finally {
    await handle?.close();
  }
}

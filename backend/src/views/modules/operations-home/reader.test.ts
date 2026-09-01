import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readOperationsHomeSnapshot } from './reader.js';

const NOW = 2_000;

describe('operations-home snapshot reader', () => {
  let directory = '';
  let snapshotPath = '';
  beforeEach(async () => {
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'operations-home-')));
    snapshotPath = path.join(directory, 'operations-home.json');
  });
  afterEach(async () => fs.rm(directory, { recursive: true, force: true }));

  async function write(value: unknown): Promise<void> {
    await fs.writeFile(snapshotPath, JSON.stringify(value), { mode: 0o600 });
    await fs.chmod(snapshotPath, 0o600);
  }

  function fixture(): Record<string, unknown> {
    return {
      schemaVersion: 1,
      mode: 'read-only',
      generatedAt: NOW - 5,
      overall: { status: 'ready', icon: '+', label: 'Ready' },
      needsAttention: [],
      work: {
        countsTrusted: true,
        active: 1,
        inFlight: 2,
        reported: 3,
        capacity: { label: '2 available of 4' },
        items: [
          {
            workId: 'KitFlowApp-42hk.44',
            displayId: 'KitFlowApp-42hk.44',
            outcome: 'active',
            lastProgressAt: NOW - 6,
            lastProgressLabel: '6s ago',
            receiptCount: 3,
            laneId: 'contentbuild-a2',
            beadId: 'KitFlowApp-42hk.44',
            attemptRef: 'attempt-42856fc',
            sessionRef: 'nodea-claude-1',
            agentRef: 'tier2-contentbuild',
          },
        ],
      },
      services: [
        {
          source: 'linear',
          title: 'Linear',
          status: 'ready',
          icon: '+',
          label: 'Ready',
          explanation: 'Verified.',
          freshness: { label: '5s old' },
          credential: 'never-return-me',
        },
      ],
      controls: [],
      credential: 'never-return-me',
    };
  }

  function options() {
    return {
      snapshotPath,
      expectedUid: process.getuid!(),
      expectedMode: 0o600,
      maxAgeSeconds: 60,
      maxBytes: 1024 * 1024,
      now: () => NOW,
    };
  }

  test('returns only the bounded read-only display projection', async () => {
    await write(fixture());
    const result = await readOperationsHomeSnapshot(options());
    assert.equal(result.availability, 'available');
    assert.equal(result.controls.length, 0);
    assert.ok(!JSON.stringify(result).includes('never-return-me'));
    if (result.availability !== 'available') assert.fail('snapshot should be available');
    assert.deepEqual(result.work.items, [
      {
        workId: 'KitFlowApp-42hk.44',
        displayId: 'KitFlowApp-42hk.44',
        outcome: 'active',
        lastProgressAt: NOW - 6,
        lastProgressLabel: '6s ago',
        receiptCount: 3,
        laneId: 'contentbuild-a2',
        beadId: 'KitFlowApp-42hk.44',
        attemptRef: 'attempt-42856fc',
        sessionRef: 'nodea-claude-1',
        agentRef: 'tier2-contentbuild',
      },
    ]);
  });

  test('accepts the producer degraded state with its exact presentation', async () => {
    const degraded = fixture();
    degraded.overall = { status: 'degraded', icon: '~', label: 'Degraded' };
    const services = degraded.services as Array<Record<string, unknown>>;
    services[0] = {
      ...services[0],
      status: 'degraded',
      icon: '~',
      label: 'Degraded',
    };
    await write(degraded);

    const result = await readOperationsHomeSnapshot(options());
    assert.equal(result.availability, 'available');
    if (result.availability !== 'available') assert.fail('snapshot should be available');
    assert.equal(result.overall.status, 'degraded');
    assert.equal(result.services[0]?.status, 'degraded');

    services[0]!.label = 'Ready';
    await write(degraded);
    const rejected = await readOperationsHomeSnapshot(options());
    assert.equal(rejected.availability, 'unavailable');
  });

  test('preserves unavailable live identity as null and rejects malformed identity', async () => {
    const missing = fixture();
    const missingWork = missing.work as { items: Array<Record<string, unknown>> };
    delete missingWork.items[0]?.sessionRef;
    delete missingWork.items[0]?.agentRef;
    await write(missing);
    const result = await readOperationsHomeSnapshot(options());
    assert.equal(result.availability, 'available');
    if (result.availability !== 'available') assert.fail('snapshot should be available');
    assert.equal(result.work.items[0]?.sessionRef, null);
    assert.equal(result.work.items[0]?.agentRef, null);

    const malformed = fixture();
    const malformedWork = malformed.work as { items: Array<Record<string, unknown>> };
    malformedWork.items[0]!.sessionRef = { secret: 'not-a-public-reference' };
    await write(malformed);
    const rejected = await readOperationsHomeSnapshot(options());
    assert.equal(rejected.availability, 'unavailable');
    if (rejected.availability === 'unavailable') assert.equal(rejected.reason, 'snapshot-invalid');
  });

  test('fails closed on stale, malformed, non-empty controls, or a symlink', async () => {
    const stale = fixture();
    stale.generatedAt = NOW - 61;
    await write(stale);
    assert.equal((await readOperationsHomeSnapshot(options())).availability, 'unavailable');
    const controlled = fixture();
    controlled.controls = [{ action: 'restart' }];
    await write(controlled);
    assert.equal((await readOperationsHomeSnapshot(options())).availability, 'unavailable');
    await fs.writeFile(snapshotPath, '{', { mode: 0o600 });
    assert.equal((await readOperationsHomeSnapshot(options())).availability, 'unavailable');
    const target = path.join(directory, 'target.json');
    await fs.rename(snapshotPath, target);
    await fs.symlink(target, snapshotPath);
    assert.equal((await readOperationsHomeSnapshot(options())).availability, 'unavailable');
  });
});

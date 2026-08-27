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

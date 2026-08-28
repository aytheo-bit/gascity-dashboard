import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import http, { type Server } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import type { AdminConfig } from '../src/config.js';
import { createDashboardApp } from '../src/app.js';

function makeConfig(overrides: Partial<AdminConfig> = {}): AdminConfig {
  return {
    port: 8081,
    bindHost: '127.0.0.1',
    extraAllowedHosts: [],
    // Unroutable supervisor so city dispatch fails fast.
    gcSupervisorUrl: 'http://127.0.0.1:1',
    cityName: 'test-city',
    cityPath: '',
    runCwdAllowedRoots: [],
    auditLogPath: '.gc/events.jsonl',
    frontendDistPath: '../frontend/dist-does-not-exist',
    disabled: false,
    readOnly: false,
    operatorAlias: 'operator',
    operatorWireAlias: 'human',
    decisionLabel: 'needs/operator',
    modules: {
      operationsHome: {
        snapshotPath: '',
        expectedUid: 0,
        expectedMode: 0o600,
        maxAgeSeconds: 300,
        maxBytes: 1048576,
      },
      maintainer: {
        githubRepo: 'gastownhall/gascity',
        slingTarget: 'mayor',
        triageTarget: 'chief-of-staff',
        refreshIntervalMs: 0,
        cachePath: '.gascity-dashboard/maintainer-cache.json',
      },
    },
    useFixtures: false,
    enabledModules: null,
    defaultView: null,
    ...overrides,
  };
}

async function withApp<T>(app: Express, fn: (url: string) => Promise<T>): Promise<T> {
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function withSupervisorRegistry<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = await new Promise<Server>((resolve) => {
    const listening = http.createServer((req, res) => {
      if (req.url === '/v0/cities') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            items: [{ name: 'test-city', path: '/srv/gc/test-city', running: true }],
            total: 1,
          }),
        );
        return;
      }
      if (req.url === '/v0/city/test-city/beads?limit=1000') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            items: [
              {
                id: 'td-bead-abc123',
                title: 'old mirror should not serve this',
                status: 'open',
                issue_type: 'task',
                created_at: '2026-06-01T00:00:00Z',
                priority: null,
              },
            ],
            total: 1,
          }),
        );
        return;
      }
      if (req.url === '/v0/city/test-city/bead/td-bead-abc123') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'td-bead-abc123',
            title: 'old detail mirror should not serve this',
            status: 'open',
            issue_type: 'task',
            created_at: '2026-06-01T00:00:00Z',
            priority: null,
          }),
        );
        return;
      }
      if (req.url === '/v0/city/test-city/mail?limit=1000') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            items: [
              {
                id: 'mail-1',
                from: 'mayor',
                to: 'human',
                subject: 'old mail mirror should not serve this',
                body: 'body',
                created_at: '2026-06-01T00:00:00Z',
                read: false,
                thread_id: 'thread-1',
              },
            ],
            total: 1,
          }),
        );
        return;
      }
      if (req.url === '/v0/city/test-city/mail/thread/thread-1') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            items: [
              {
                id: 'mail-1',
                from: 'mayor',
                to: 'human',
                subject: 'old thread mirror should not serve this',
                body: 'body',
                created_at: '2026-06-01T00:00:00Z',
                read: false,
                thread_id: 'thread-1',
              },
            ],
            total: 1,
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    });
    listening.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('createDashboardApp', () => {
  test('serves the top-level health endpoint independent of any city', async () => {
    const { app, runtime } = createDashboardApp(makeConfig());
    runtime.start();
    try {
      await withApp(app, async (url) => {
        const health = await fetch(`${url}/api/health`);
        assert.equal(health.status, 200);
        const body = (await health.json()) as { ok: boolean; ts: string };
        assert.equal(body.ok, true);
        assert.equal(typeof body.ts, 'string');
      });
    } finally {
      await runtime.stop();
    }
  });

  test('serves dashboard-local system health independent of supervisor city dispatch', async () => {
    const { app, runtime } = createDashboardApp(makeConfig());
    runtime.start();
    try {
      await withApp(app, async (url) => {
        const health = await fetch(`${url}/api/health/system`);
        assert.equal(health.status, 200);
        const body = (await health.json()) as {
          admin?: unknown;
          host?: unknown;
          supervisor?: unknown;
          diagnostics?: unknown;
        };
        assert.equal(typeof body.admin, 'object');
        assert.equal(typeof body.host, 'object');
        assert.equal(body.supervisor, undefined);
        assert.equal(body.diagnostics, undefined);
      });
    } finally {
      await runtime.stop();
    }
  });

  test('rejects a path-traversal :cityName at the dispatch boundary (400)', async () => {
    const { app, runtime } = createDashboardApp(makeConfig());
    runtime.start();
    try {
      await withApp(app, async (url) => {
        const res = await fetch(`${url}/api/city/%2e%2e%2fetc/config`);
        assert.equal(res.status, 400);
        const body = (await res.json()) as { kind?: string };
        assert.equal(body.kind, 'validation');
      });
    } finally {
      await runtime.stop();
    }
  });

  test('city dispatch surfaces an upstream error when the supervisor registry is unreachable', async () => {
    const { app, runtime } = createDashboardApp(makeConfig());
    runtime.start();
    try {
      await withApp(app, async (url) => {
        const res = await fetch(`${url}/api/city/test-city/config`);
        // Unroutable supervisor -> the /v0/cities lookup fails, mapped to a
        // 502/504 upstream error. NEVER a silent fallback / 200.
        assert.ok(
          res.status === 502 || res.status === 504,
          `expected upstream error status, got ${res.status}`,
        );
      });
    } finally {
      await runtime.stop();
    }
  });

  test('serves the explicitly enabled default-city Operations Home snapshot without a supervisor', async () => {
    const directory = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'operations-home-app-')),
    );
    const snapshotPath = path.join(directory, 'operations-home.json');
    await fs.writeFile(
      snapshotPath,
      JSON.stringify({
        schemaVersion: 1,
        mode: 'read-only',
        generatedAt: Date.now() / 1000 - 1,
        overall: { status: 'ready', icon: '+', label: 'Ready' },
        needsAttention: [],
        work: {
          countsTrusted: true,
          active: 0,
          inFlight: 0,
          reported: 0,
          capacity: { label: 'Available' },
        },
        services: [],
        controls: [],
      }),
      { mode: 0o600 },
    );
    await fs.chmod(snapshotPath, 0o600);
    const config = makeConfig({
      readOnly: true,
      enabledModules: new Set(['operations-home']),
      modules: {
        ...makeConfig().modules,
        operationsHome: {
          snapshotPath,
          expectedUid: process.getuid!(),
          expectedMode: 0o600,
          maxAgeSeconds: 60,
          maxBytes: 1024 * 1024,
        },
      },
    });
    const { app, runtime } = createDashboardApp(config);
    runtime.start();
    try {
      await withApp(app, async (url) => {
        const response = await fetch(`${url}/api/city/test-city/operations-home`);
        assert.equal(response.status, 200);
        const body = (await response.json()) as {
          availability?: string;
          mode?: string;
          generatedAt?: number;
          controls?: unknown[];
        };
        assert.deepEqual(body, {
          availability: 'available',
          schemaVersion: 1,
          mode: 'read-only',
          generatedAt: body.generatedAt,
          overall: { status: 'ready', icon: '+', label: 'Ready' },
          needsAttention: [],
          work: {
            countsTrusted: true,
            active: 0,
            inFlight: 0,
            reported: 0,
            capacityLabel: 'Available',
          },
          services: [],
          controls: [],
        });
      });
    } finally {
      await runtime.stop();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test('serves byte-identical runtime config for the admitted local Operations Home city', async () => {
    const config = makeConfig({
      cityPath: '/srv/local/test-city',
      readOnly: true,
      enabledModules: new Set(['operations-home']),
      defaultView: 'operations-home',
    });
    const { app, runtime } = createDashboardApp(config);
    runtime.start();
    try {
      await withApp(app, async (url) => {
        const response = await fetch(`${url}/api/city/test-city/config`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          cityName: 'test-city',
          cityRoot: '/srv/local/test-city',
          useFixtures: false,
          readOnly: true,
          operatorAlias: 'operator',
          operatorWireAlias: 'human',
          decisionLabel: 'needs/operator',
          enabledModules: ['operations-home'],
          defaultView: 'operations-home',
        });
      });
    } finally {
      await runtime.stop();
    }
  });

  test('local runtime config remains supervisor and security gated outside the exact admission', async () => {
    const cases: Array<{ config: AdminConfig; city: string }> = [
      {
        config: makeConfig({ readOnly: true, enabledModules: null }),
        city: 'test-city',
      },
      {
        config: makeConfig({
          readOnly: false,
          enabledModules: new Set(['operations-home']),
        }),
        city: 'test-city',
      },
      {
        config: makeConfig({
          readOnly: true,
          enabledModules: new Set(['operations-home']),
        }),
        city: 'other-city',
      },
    ];

    for (const item of cases) {
      const { app, runtime } = createDashboardApp(item.config);
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const response = await fetch(`${url}/api/city/${item.city}/config`);
          assert.ok(response.status === 502 || response.status === 504);
        });
      } finally {
        await runtime.stop();
      }
    }

    const admitted = makeConfig({
      readOnly: true,
      enabledModules: new Set(['operations-home']),
    });
    const { app, runtime } = createDashboardApp(admitted);
    runtime.start();
    try {
      await withApp(app, async (url) => {
        const csrf = await fetch(`${url}/api/csrf`);
        const csrfBody = (await csrf.json()) as { token: string };
        const response = await fetch(`${url}/api/city/test-city/config`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://127.0.0.1:8081',
            'x-csrf-token': csrfBody.token,
          },
          body: '{}',
        });
        assert.ok(response.status === 502 || response.status === 504);
      });
    } finally {
      await runtime.stop();
    }
  });

  test('local Operations Home bypass remains fail closed for controls, invalid snapshots, and other cities', async () => {
    const directory = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'operations-home-app-')),
    );
    const snapshotPath = path.join(directory, 'operations-home.json');
    await fs.writeFile(snapshotPath, '{', { mode: 0o600 });
    await fs.chmod(snapshotPath, 0o600);
    const config = makeConfig({
      readOnly: true,
      enabledModules: new Set(['operations-home']),
      modules: {
        ...makeConfig().modules,
        operationsHome: {
          snapshotPath,
          expectedUid: process.getuid!(),
          expectedMode: 0o600,
          maxAgeSeconds: 60,
          maxBytes: 1024 * 1024,
        },
      },
    });
    const { app, runtime } = createDashboardApp(config);
    runtime.start();
    try {
      await withApp(app, async (url) => {
        const invalid = await fetch(`${url}/api/city/test-city/operations-home`);
        assert.equal(invalid.status, 503);
        assert.deepEqual(await invalid.json(), {
          availability: 'unavailable',
          reason: 'snapshot-invalid',
          controls: [],
        });

        const csrf = await fetch(`${url}/api/csrf`);
        const csrfBody = (await csrf.json()) as { token: string };
        const control = await fetch(`${url}/api/city/test-city/operations-home`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://127.0.0.1:8081',
            'x-csrf-token': csrfBody.token,
          },
          body: '{}',
        });
        assert.equal(control.status, 405);
        assert.equal(control.headers.get('allow'), 'GET, HEAD');
        assert.deepEqual(await control.json(), {
          error: 'method not allowed',
          kind: 'read-only',
        });

        const otherCity = await fetch(`${url}/api/city/other-city/operations-home`);
        assert.ok(otherCity.status === 502 || otherCity.status === 504);
      });
    } finally {
      await runtime.stop();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test('disabled or writable Operations Home never bypasses supervisor city dispatch', async () => {
    for (const config of [
      makeConfig({ readOnly: true, enabledModules: null }),
      makeConfig({ readOnly: false, enabledModules: new Set(['operations-home']) }),
    ]) {
      const { app, runtime } = createDashboardApp(config);
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const response = await fetch(`${url}/api/city/test-city/operations-home`);
          assert.ok(response.status === 502 || response.status === 504);
        });
      } finally {
        await runtime.stop();
      }
    }
  });

  test('does not mount the dashboard sessions mirror under the city request plane', async () => {
    await withSupervisorRegistry(async (gcSupervisorUrl) => {
      const { app, runtime } = createDashboardApp(makeConfig({ gcSupervisorUrl }));
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const res = await fetch(`${url}/api/city/test-city/sessions`);
          assert.equal(res.status, 404);

          const stream = await fetch(
            `${url}/api/city/test-city/session-stream/gc-session-b/stream`,
          );
          assert.equal(stream.status, 404);
          await stream.body?.cancel();
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  test('does not mount the dashboard agents roster mirror under the city request plane', async () => {
    await withSupervisorRegistry(async (gcSupervisorUrl) => {
      const { app, runtime } = createDashboardApp(makeConfig({ gcSupervisorUrl }));
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const res = await fetch(`${url}/api/city/test-city/agents`);
          assert.equal(res.status, 404);
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  test('mounts only the city-scoped dashboard run diff route', async () => {
    await withSupervisorRegistry(async (gcSupervisorUrl) => {
      const { app, runtime } = createDashboardApp(makeConfig({ gcSupervisorUrl }));
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const oldDetailMirror = await fetch(`${url}/api/city/test-city/runs/gc-root`);
          assert.equal(oldDetailMirror.status, 404);

          const csrf = await fetch(`${url}/api/csrf`);
          const csrfBody = (await csrf.json()) as { token: string };
          const diff = await fetch(`${url}/api/city/test-city/runs/gc-root/diff`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: 'http://127.0.0.1:8081',
              'x-csrf-token': csrfBody.token,
            },
            body: JSON.stringify({
              executionPath: {
                kind: 'unavailable',
                reason: 'missing_cwd_and_rig_root',
              },
            }),
          });
          assert.equal(diff.status, 200);
          const body = (await diff.json()) as { kind?: string };
          assert.equal(body.kind, 'path_unknown');
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  test('does not mount the dashboard beads read mirrors under the city request plane', async () => {
    await withSupervisorRegistry(async (gcSupervisorUrl) => {
      const { app, runtime } = createDashboardApp(makeConfig({ gcSupervisorUrl }));
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const list = await fetch(`${url}/api/city/test-city/beads`);
          assert.equal(list.status, 404);

          const detail = await fetch(`${url}/api/city/test-city/beads/td-bead-abc123`);
          assert.equal(detail.status, 404);
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  test('does not mount the dashboard mail read mirrors under the city request plane', async () => {
    await withSupervisorRegistry(async (gcSupervisorUrl) => {
      const { app, runtime } = createDashboardApp(makeConfig({ gcSupervisorUrl }));
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const list = await fetch(`${url}/api/city/test-city/mail?alias=stephanie&box=inbox`);
          assert.equal(list.status, 404);

          const thread = await fetch(
            `${url}/api/city/test-city/mail/threads/thread-1?alias=stephanie`,
          );
          assert.equal(thread.status, 404);
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  test('does not mount the dashboard mail send mirror under the city request plane', async () => {
    await withSupervisorRegistry(async (gcSupervisorUrl) => {
      const { app, runtime } = createDashboardApp(makeConfig({ gcSupervisorUrl }));
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const csrf = await fetch(`${url}/api/csrf`);
          const csrfBody = (await csrf.json()) as { token: string };
          const res = await fetch(`${url}/api/city/test-city/mail-send`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: 'http://127.0.0.1:8081',
              'x-csrf-token': csrfBody.token,
            },
            body: JSON.stringify({
              to: 'mayor',
              subject: 'status',
              body: 'all green',
            }),
          });
          assert.equal(res.status, 404);
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  test('does not mount the old maintainer sling supervisor facade under the city request plane', async () => {
    await withSupervisorRegistry(async (gcSupervisorUrl) => {
      const { app, runtime } = createDashboardApp(
        makeConfig({
          gcSupervisorUrl,
          enabledModules: new Set(['maintainer']),
        }),
      );
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const csrf = await fetch(`${url}/api/csrf`);
          const csrfBody = (await csrf.json()) as { token: string };
          const res = await fetch(`${url}/api/city/test-city/maintainer/sling`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: 'http://127.0.0.1:8081',
              'x-csrf-token': csrfBody.token,
            },
            body: JSON.stringify({
              kind: 'pr',
              number: 47,
              html_url: 'https://github.com/gastownhall/gascity/pull/47',
              intent: 'triage',
            }),
          });
          assert.equal(res.status, 404);
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  test('does not mount the dashboard city events stream mirror under the city request plane', async () => {
    await withSupervisorRegistry(async (gcSupervisorUrl) => {
      const { app, runtime } = createDashboardApp(makeConfig({ gcSupervisorUrl }));
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const stream = await fetch(`${url}/api/city/test-city/events/stream`);
          assert.equal(stream.status, 404);
          await stream.body?.cancel();
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  test('does not mount dashboard links, snapshot, or home-pending mirrors under the city request plane', async () => {
    await withSupervisorRegistry(async (gcSupervisorUrl) => {
      const { app, runtime } = createDashboardApp(makeConfig({ gcSupervisorUrl }));
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const links = await fetch(`${url}/api/city/test-city/links/td-bead-abc123`);
          assert.equal(links.status, 404);

          const snapshot = await fetch(`${url}/api/city/test-city/snapshot`);
          assert.equal(snapshot.status, 404);

          const csrf = await fetch(`${url}/api/csrf`);
          const csrfBody = (await csrf.json()) as { token: string };
          const refresh = await fetch(`${url}/api/city/test-city/snapshot/refresh`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: 'http://127.0.0.1:8081',
              'x-csrf-token': csrfBody.token,
            },
            body: JSON.stringify({ sources: ['runs'] }),
          });
          assert.equal(refresh.status, 404);

          const pending = await fetch(`${url}/api/city/test-city/home/pending/stream`);
          assert.equal(pending.status, 404);
          await pending.body?.cancel();
        });
      } finally {
        await runtime.stop();
      }
    });
  });
});

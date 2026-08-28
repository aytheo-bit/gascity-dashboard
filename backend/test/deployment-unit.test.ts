import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dashboardUnit = fs.readFileSync(
  path.join(repositoryRoot, 'deploy/gas-city-dashboard.service'),
  'utf8',
);

test('dashboard unit permits Node V8 executable pages without relaxing other hardening', () => {
  assert.doesNotMatch(dashboardUnit, /^MemoryDenyWriteExecute=/m);
  for (const directive of [
    'NoNewPrivileges=true',
    'ProtectSystem=strict',
    'ProtectHome=read-only',
    'PrivateTmp=true',
    'PrivateDevices=true',
    'ProtectKernelTunables=true',
    'ProtectKernelModules=true',
    'ProtectControlGroups=true',
    'RestrictNamespaces=true',
    'LockPersonality=true',
    'SystemCallArchitectures=native',
  ]) {
    assert.match(dashboardUnit, new RegExp(`^${directive}$`, 'm'));
  }
});

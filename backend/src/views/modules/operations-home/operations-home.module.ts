import { Router } from 'express';
import type { BackendModule } from '../../types.js';
import { readOperationsHomeSnapshot } from './reader.js';

export interface OperationsHomeDeps {
  snapshotPath: string;
  expectedUid: number;
  expectedMode: number;
  maxAgeSeconds: number;
  maxBytes: number;
}

export const operationsHomeBackend: BackendModule<OperationsHomeDeps> = {
  id: 'operations-home',
  kind: 'firstParty',
  resources: { filesystem: [{ name: 'snapshot', scope: 'perProcess' }] },
  needs: (config) => ({ ...config.modules.operationsHome }),
  mount: (_ctx, deps) => {
    const router = Router();
    router.get('/', async (_req, res) => {
      const snapshot = await readOperationsHomeSnapshot(deps);
      res.status(snapshot.availability === 'available' ? 200 : 503).json(snapshot);
    });
    return router;
  },
};

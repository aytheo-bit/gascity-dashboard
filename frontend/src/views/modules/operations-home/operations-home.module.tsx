import { lazy } from 'react';
import type { FrontendViewDescriptor } from '../../types';

export const operationsHomeView: FrontendViewDescriptor = {
  id: 'operations-home',
  kind: 'firstParty',
  path: '/operations',
  nav: { label: 'Operations', order: 10 },
  element: lazy(() =>
    import('./OperationsHome').then((module) => ({ default: module.OperationsHomePage })),
  ),
};

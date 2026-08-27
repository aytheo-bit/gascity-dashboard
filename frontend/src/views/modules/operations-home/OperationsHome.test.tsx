import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { setActiveCity } from '../../../api/cityBase';
import { OperationsHomePage } from './OperationsHome';

describe('OperationsHomePage', () => {
  beforeEach(() => {
    setActiveCity('test-city');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the canonical read-only summary without controls', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        availability: 'available',
        schemaVersion: 1,
        mode: 'read-only',
        generatedAt: 100,
        overall: { status: 'ready', icon: '+', label: 'Ready' },
        needsAttention: [],
        work: {
          countsTrusted: true,
          active: 1,
          inFlight: 2,
          reported: 3,
          capacityLabel: '2 available of 4',
        },
        services: [
          {
            source: 'linear',
            title: 'Linear',
            status: 'ready',
            icon: '+',
            label: 'Ready',
            explanation: 'Verified.',
            freshnessLabel: '5s old',
          },
        ],
        controls: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<OperationsHomePage />);
    expect(await screen.findByText('Nothing currently needs attention.')).toBeTruthy();
    expect(screen.getByText('2 available of 4')).toBeTruthy();
    expect(screen.getByText(/No operational controls\./)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/city/test-city/operations-home',
      expect.any(Object),
    );
  });

  it('fails closed when the snapshot is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<OperationsHomePage />);
    expect((await screen.findByRole('alert')).textContent).toContain('Readiness is not proven');
  });
});

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
          items: [
            {
              workId: 'KitFlowApp-42hk.44',
              displayId: 'ContentBuild Linux port',
              outcome: 'active',
              lastProgressAt: 95,
              lastProgressLabel: '5s ago',
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
    expect(screen.getByText('ContentBuild Linux port')).toBeTruthy();
    expect(screen.getByText(/Lane contentbuild-a2/)).toBeTruthy();
    expect(screen.getByText(/Bead KitFlowApp-42hk\.44/)).toBeTruthy();
    expect(screen.getByText(/Session nodea-claude-1/)).toBeTruthy();
    expect(screen.getByText(/Agent tier2-contentbuild/)).toBeTruthy();
    expect(screen.getByText(/No operational controls\./)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/city/test-city/operations-home',
      expect.any(Object),
    );
  });

  it('states when session and agent identity are unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
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
            inFlight: 1,
            reported: 1,
            capacityLabel: 'Not reported',
            items: [
              {
                workId: 'contentbuild-a2',
                displayId: 'contentbuild-a2',
                outcome: 'active',
                lastProgressAt: 95,
                lastProgressLabel: '5s ago',
                receiptCount: null,
                laneId: 'contentbuild-a2',
                beadId: null,
                attemptRef: 'attempt-42856fc',
                sessionRef: null,
                agentRef: null,
              },
            ],
          },
          services: [],
          controls: [],
        }),
      }),
    );
    render(<OperationsHomePage />);
    expect(await screen.findByText(/Session unavailable/)).toBeTruthy();
    expect(screen.getByText(/Agent unavailable/)).toBeTruthy();
  });

  it('renders degraded readiness as an explicit warning state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          availability: 'available',
          schemaVersion: 1,
          mode: 'read-only',
          generatedAt: 100,
          overall: { status: 'degraded', icon: '~', label: 'Degraded' },
          needsAttention: [],
          work: {
            countsTrusted: false,
            active: null,
            inFlight: null,
            reported: null,
            capacityLabel: 'Not reported',
            items: [],
          },
          services: [
            {
              source: 'providers',
              title: 'Provider pools',
              status: 'degraded',
              icon: '~',
              label: 'Degraded',
              explanation: 'At least one provider pool is unavailable.',
              freshnessLabel: '5s old',
            },
          ],
          controls: [],
        }),
      }),
    );
    render(<OperationsHomePage />);
    const degraded = await screen.findByText('Degraded');
    expect(degraded.parentElement?.className).toContain('text-warn');
    expect(screen.getByText('Provider pools').parentElement?.className).toContain('text-warn');
  });

  it('fails closed when the snapshot is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<OperationsHomePage />);
    expect((await screen.findByRole('alert')).textContent).toContain('Readiness is not proven');
  });
});

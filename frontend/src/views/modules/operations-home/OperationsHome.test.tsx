import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { SessionResponse } from 'gas-city-dashboard-shared/gc-supervisor';
import { setActiveCity } from '../../../api/cityBase';
import {
  GC_MUTATION_HEADERS,
  resetSupervisorApiForTests,
  setSupervisorApiForTests,
  type SupervisorApi,
} from '../../../supervisor/client';
import { OperationsHomePage } from './OperationsHome';

function session(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    id: 'nodea-claude-1',
    template: 'claude',
    session_name: 'tmux-1',
    title: 'ContentBuild Linux port',
    state: 'running',
    created_at: '2026-06-28T00:00:00Z',
    attached: false,
    running: true,
    provider: 'anthropic',
    model: 'claude-opus-5',
    ...overrides,
  };
}

function fakeSupervisorApi(listSessions: SupervisorApi['listSessions']): SupervisorApi {
  return {
    baseUrl: '/gc-supervisor',
    health: vi.fn(),
    cityHealth: vi.fn(),
    cityStatus: vi.fn(),
    listCities: vi.fn(),
    listAgents: vi.fn(),
    listRigs: vi.fn(),
    listBeads: vi.fn(),
    listEvents: vi.fn(),
    getBead: vi.fn(),
    beadsGraph: vi.fn(),
    createBead: vi.fn(),
    updateBead: vi.fn(),
    closeBead: vi.fn(),
    nudgeAgent: vi.fn(),
    agentPrime: vi.fn(),
    sling: vi.fn(),
    formulaFeed: vi.fn(),
    listMail: vi.fn(),
    markMailRead: vi.fn(),
    markMailUnread: vi.fn(),
    archiveMail: vi.fn(),
    replyMail: vi.fn(),
    sendMail: vi.fn(),
    mailThread: vi.fn(),
    cityEventStreamUrl: vi.fn(),
    sessionStreamUrl: vi.fn(),
    listSessions,
    sessionPending: vi.fn(),
    respondSession: vi.fn(),
    sessionTranscript: vi.fn(),
    workflowRun: vi.fn(),
    formulaDetail: vi.fn(),
    mutationHeaders: () => ({ ...GC_MUTATION_HEADERS }),
  };
}

function workItem(overrides: Record<string, unknown> = {}) {
  return {
    workId: 'contentbuild-a2',
    displayId: 'contentbuild-a2',
    outcome: 'active',
    lastProgressAt: 95,
    lastProgressLabel: '5s ago',
    receiptCount: 3,
    laneId: 'contentbuild-a2',
    beadId: 'contentbuild-a2',
    attemptRef: 'attempt-42856fc',
    sessionRef: 'nodea-claude-1',
    agentRef: 'tier2-contentbuild',
    ...overrides,
  };
}

function snapshotWith(items: ReturnType<typeof workItem>[]) {
  return {
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
      capacityLabel: '2 available of 4',
      items,
    },
    services: [],
    controls: [],
  };
}

describe('OperationsHomePage', () => {
  beforeEach(() => {
    setActiveCity('test-city');
    setSupervisorApiForTests(fakeSupervisorApi(vi.fn(async () => ({ items: [], total: 0 }))));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    resetSupervisorApiForTests();
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

  it('joins a resolved session to show the human title and exact live provider/model', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ json: async () => snapshotWith([workItem()]) });
    vi.stubGlobal('fetch', fetchMock);
    const listSessions = vi.fn(async () => ({ items: [session()], total: 1 }));
    setSupervisorApiForTests(fakeSupervisorApi(listSessions));

    render(<OperationsHomePage />);

    // workId and displayId were identical on the wire ("merely a workId"), so
    // the resolved session title stands in while the stable work ID stays visible.
    expect(await screen.findByText('ContentBuild Linux port (contentbuild-a2)')).toBeTruthy();
    expect(screen.getByText(/Provider anthropic/)).toBeTruthy();
    expect(screen.getByText(/Model claude-opus-5/)).toBeTruthy();
    expect(listSessions).toHaveBeenCalledWith('test-city');
    expect(listSessions).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/city/test-city/operations-home',
      expect.any(Object),
    );
  });

  it('preserves a meaningful producer displayId instead of the resolved title', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () =>
        snapshotWith([
          workItem({ workId: 'KitFlowApp-42hk.44', displayId: 'ContentBuild Linux port' }),
        ]),
    });
    vi.stubGlobal('fetch', fetchMock);
    setSupervisorApiForTests(
      fakeSupervisorApi(vi.fn(async () => ({ items: [session({ title: 'Other title' })], total: 1 }))),
    );

    render(<OperationsHomePage />);

    expect(await screen.findByText('ContentBuild Linux port')).toBeTruthy();
    expect(screen.queryByText(/Other title/)).toBeNull();
  });

  it('falls back to unavailable identity when sessionRef is null', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ json: async () => snapshotWith([workItem({ sessionRef: null })]) });
    vi.stubGlobal('fetch', fetchMock);
    setSupervisorApiForTests(
      fakeSupervisorApi(vi.fn(async () => ({ items: [session()], total: 1 }))),
    );

    render(<OperationsHomePage />);

    expect(await screen.findByText('contentbuild-a2')).toBeTruthy();
    expect(screen.getByText(/Session unavailable/)).toBeTruthy();
    expect(screen.getByText(/Provider unavailable/)).toBeTruthy();
    expect(screen.getByText(/Model unavailable/)).toBeTruthy();
  });

  it('still renders the snapshot when the session read fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ json: async () => snapshotWith([workItem()]) });
    vi.stubGlobal('fetch', fetchMock);
    setSupervisorApiForTests(
      fakeSupervisorApi(vi.fn().mockRejectedValue(new Error('sessions unavailable'))),
    );

    render(<OperationsHomePage />);

    expect(await screen.findByText('contentbuild-a2')).toBeTruthy();
    expect((await screen.findByRole('status')).textContent).toContain(
      'Live session details are unavailable. Readiness and stable work IDs remain visible.',
    );
    expect(screen.getByText(/Provider unavailable/)).toBeTruthy();
    expect(screen.getByText(/Model unavailable/)).toBeTruthy();
    expect(screen.getByText(/No operational controls\./)).toBeTruthy();
  });

  it('renders no controls regardless of session resolution', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ json: async () => snapshotWith([workItem()]) });
    vi.stubGlobal('fetch', fetchMock);
    setSupervisorApiForTests(fakeSupervisorApi(vi.fn(async () => ({ items: [session()], total: 1 }))));

    render(<OperationsHomePage />);

    await screen.findByText(/No operational controls\./);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

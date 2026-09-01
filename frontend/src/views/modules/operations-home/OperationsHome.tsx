import { useEffect, useState } from 'react';
import type { DashboardSession, OperationsHomeResponse, OperationsHomeStatus } from 'gas-city-dashboard-shared';
import { cityPath } from '../../../api/cityBase';
import { PageHeader } from '../../../components/PageHeader';
import { StatusBadge, type StatusTone } from '../../../components/StatusBadge';
import { listSupervisorSessions, normalizeSessions } from '../../../supervisor/sessionReads';

const UNAVAILABLE: OperationsHomeResponse = {
  availability: 'unavailable',
  reason: 'snapshot-unavailable',
  controls: [],
};

type WorkItem = Extract<
  OperationsHomeResponse,
  { availability: 'available' }
>['work']['items'][number];

export function OperationsHomePage() {
  const [snapshot, setSnapshot] = useState<OperationsHomeResponse | null>(null);
  const [sessionsById, setSessionsById] = useState<ReadonlyMap<string, DashboardSession>>(
    new Map(),
  );
  const [sessionReadFailed, setSessionReadFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(cityPath('/operations-home'), { signal: controller.signal })
      .then(async (response) => (await response.json()) as OperationsHomeResponse)
      .then((value) => setSnapshot(value.controls.length === 0 ? value : UNAVAILABLE))
      .catch(() => setSnapshot(UNAVAILABLE));
    return () => controller.abort();
  }, []);
  useEffect(() => {
    let cancelled = false;
    void listSupervisorSessions()
      .then((list) => {
        if (cancelled) return;
        const byId = new Map<string, DashboardSession>();
        for (const session of normalizeSessions(list)) {
          byId.set(session.id, session);
        }
        setSessionReadFailed(false);
        setSessionsById(byId);
      })
      .catch(() => {
        if (!cancelled) setSessionReadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (snapshot === null) {
    return (
      <section>
        <PageHeader title="Operations" synopsis="Reading the latest local readiness snapshot." />
        <p className="text-body text-fg-muted italic">Loading.</p>
      </section>
    );
  }
  if (snapshot.availability === 'unavailable') {
    return (
      <section>
        <PageHeader title="Operations" synopsis="Read-only operational readiness." />
        <p className="text-body text-accent" role="alert">
          Operations snapshot unavailable. Readiness is not proven.
        </p>
      </section>
    );
  }
  return (
    <section>
      <PageHeader
        title="Operations"
        synopsis="Read-only operational readiness across KitFlow services and active work."
        meta={
          <StatusBadge
            tone={tone(snapshot.overall.status)}
            label={snapshot.overall.label}
            glyph={snapshot.overall.icon}
          />
        }
      />
      <div className="space-y-12">
        <section aria-labelledby="operations-attention">
          <h2 id="operations-attention" className="text-title font-semibold text-fg mb-4">
            Needs attention
          </h2>
          {snapshot.needsAttention.length === 0 ? (
            <p className="text-body text-fg-muted">Nothing currently needs attention.</p>
          ) : (
            <ul className="space-y-3">
              {snapshot.needsAttention.map((item) => (
                <li key={`${item.kind}:${item.id}`} className="grid gap-1 sm:grid-cols-[12rem_1fr]">
                  <StatusBadge tone={tone(item.status)} label={item.title} glyph={item.icon} />
                  <span className="text-body text-fg-muted">{item.explanation}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="operations-work">
          <h2 id="operations-work" className="text-title font-semibold text-fg mb-4">
            Work and capacity
          </h2>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-body sm:grid-cols-4">
            <Metric label="Active" value={count(snapshot.work.active)} />
            <Metric label="In flight" value={count(snapshot.work.inFlight)} />
            <Metric label="Reported" value={count(snapshot.work.reported)} />
            <Metric label="Capacity" value={snapshot.work.capacityLabel} />
          </dl>
          {sessionReadFailed ? (
            <p className="mt-6 text-body text-fg-muted" role="status">
              Live session details are unavailable. Readiness and stable work IDs remain visible.
            </p>
          ) : null}
          {snapshot.work.items.length === 0 ? (
            <p className="mt-6 text-body text-fg-muted">No lifecycle work is currently reported.</p>
          ) : (
            <ul className="mt-6 divide-y divide-rule">
              {snapshot.work.items.map((item, index) => {
                const session = item.sessionRef ? sessionsById.get(item.sessionRef) : undefined;
                return (
                  <li
                    key={`${item.workId}:${item.attemptRef ?? 'unknown-attempt'}:${index}`}
                    className="py-4"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                      <span className="text-title font-medium text-fg">
                        {resolvedDisplayName(item, session)}
                      </span>
                      <span className="text-label uppercase tracking-wider text-fg-muted">
                        {item.outcome}; progress {item.lastProgressLabel}
                      </span>
                    </div>
                    <p className="mt-2 text-body text-fg-muted">
                      {identitySummary(item, session)}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section aria-labelledby="operations-services">
          <h2 id="operations-services" className="text-title font-semibold text-fg mb-4">
            Service readiness
          </h2>
          <ul className="divide-y divide-rule">
            {snapshot.services.map((service) => (
              <li key={service.source} className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr_auto]">
                <StatusBadge
                  tone={tone(service.status)}
                  label={service.title}
                  glyph={service.icon}
                />
                <span className="text-body text-fg-muted">{service.explanation}</span>
                <span className="text-label uppercase tracking-wider text-fg-faint">
                  {service.freshnessLabel}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="mt-12 text-label uppercase tracking-wider text-fg-faint">
        Read-only view. No operational controls.
      </p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-label uppercase tracking-wider text-fg-faint">{label}</dt>
      <dd className="mt-1 text-body text-fg">{value}</dd>
    </div>
  );
}

function resolvedDisplayName(item: WorkItem, session: DashboardSession | undefined): string {
  if (item.displayId !== item.workId) return item.displayId;
  const title = session?.title;
  return title ? `${title} (${item.workId})` : item.displayId;
}

function identitySummary(item: WorkItem, session: DashboardSession | undefined): string {
  return [
    `Lane ${item.laneId ?? 'unavailable'}`,
    `Bead ${item.beadId ?? 'unavailable'}`,
    `Attempt ${item.attemptRef ?? 'unavailable'}`,
    `Session ${item.sessionRef ?? 'unavailable'}`,
    `Agent ${item.agentRef ?? 'unavailable'}`,
    `Receipts ${item.receiptCount ?? 'unavailable'}`,
    `Provider ${session?.provider ?? 'unavailable'}`,
    `Model ${session?.model ?? 'unavailable'}`,
  ].join('; ');
}
function count(value: number | null): string {
  return value === null ? 'Not proven' : String(value);
}
function tone(status: OperationsHomeStatus): StatusTone {
  return status === 'ready'
    ? 'ok'
    : status === 'blocked' || status === 'failed'
      ? 'stuck'
      : status === 'stale' || status === 'degraded'
        ? 'warn'
        : 'neutral';
}

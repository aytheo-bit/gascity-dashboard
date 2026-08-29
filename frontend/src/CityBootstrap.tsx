import { useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { CITY_NAME_RE } from 'gas-city-dashboard-shared';
import { App } from './App';
import { setActiveCity } from './api/cityBase';
import { supervisorApi } from './supervisor/client';

// gascity-dashboard-ucc — city bootstrap.
//
// The dashboard addresses one city at a time via the `/city/:cityName/*`
// URL. This component sits ABOVE the router and resolves which city the
// browser is on BEFORE the route tree (and any city-scoped fetch) mounts:
//
//  - URL already carries a valid `/city/:cityName` segment → set it active
//    and mount the app under that segment as the router basename, so every
//    existing absolute in-app link (`to="/agents"`) stays city-relative
//    without per-link churn.
//  - No city segment (e.g. a bare `/`) → fetch the city registry and
//    redirect to the first city. A not-running city is still selectable;
//    its city-scoped reads surface a city-level error rather than the
//    bootstrap silently skipping to a different one.

const CITY_SEGMENT_RE = /^\/city\/([^/]+)(?:\/|$)/;

interface ParsedCity {
  cityName: string;
  /** Router basename: everything up to and including `/city/:cityName`. */
  basename: string;
}

function parseCityFromPath(pathname: string): ParsedCity | null {
  const match = CITY_SEGMENT_RE.exec(pathname);
  if (match === null) return null;
  const raw = match[1];
  if (raw === undefined) return null;
  let cityName: string;
  try {
    cityName = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!CITY_NAME_RE.test(cityName)) return null;
  return { cityName, basename: `/city/${raw}` };
}

type BootstrapState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'empty' };

interface BootstrapCitySources {
  fetchLocalCity: (path: string) => Promise<Response>;
  listSupervisorCities: () => Promise<{ items?: Array<{ name: string }> | null }>;
}

const DEFAULT_BOOTSTRAP_SOURCES: BootstrapCitySources = {
  fetchLocalCity: (path) => fetch(path),
  listSupervisorCities: () => supervisorApi().listCities(),
};

/**
 * Resolve the city for a bare dashboard URL without letting registry order
 * override an explicitly admitted host-local Operations Home city.
 *
 * A 404 means the deployment has no such local admission and preserves the
 * normal multi-city supervisor behavior. Any present-but-malformed local
 * admission fails closed rather than silently displaying another city.
 */
export async function resolveBootstrapCity(
  sources: BootstrapCitySources = DEFAULT_BOOTSTRAP_SOURCES,
): Promise<string | null> {
  const localResponse = await sources.fetchLocalCity('/api/operations-home-city');
  if (localResponse.status !== 404) {
    if (!localResponse.ok) {
      throw new Error(`local Operations Home city lookup failed (${localResponse.status})`);
    }
    const value: unknown = await localResponse.json();
    const cityName =
      typeof value === 'object' && value !== null && 'cityName' in value
        ? (value as { cityName?: unknown }).cityName
        : undefined;
    if (typeof cityName !== 'string' || !CITY_NAME_RE.test(cityName)) {
      throw new Error('invalid local Operations Home city');
    }
    return cityName;
  }

  const list = await sources.listSupervisorCities();
  const cityName = list.items?.[0]?.name;
  if (cityName === undefined) return null;
  if (!CITY_NAME_RE.test(cityName)) throw new Error('invalid supervisor city');
  return cityName;
}

export function CityBootstrap() {
  const parsed = parseCityFromPath(window.location.pathname);
  const [state, setState] = useState<BootstrapState>({ phase: 'loading' });

  useEffect(() => {
    if (parsed !== null) return; // city already resolved from the URL
    let cancelled = false;
    void resolveBootstrapCity()
      .then((cityName) => {
        if (cancelled) return;
        if (cityName === null) {
          setState({ phase: 'empty' });
          return;
        }
        // Full navigation (not client-side) so the app remounts under the
        // chosen city's basename with the active city set deterministically.
        window.location.replace(`/city/${encodeURIComponent(cityName)}/`);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          phase: 'error',
          message: err instanceof Error ? err.message : 'failed to load cities',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [parsed]);

  if (parsed !== null) {
    // Make the active city available to every city-scoped fetch before the
    // route tree mounts. Synchronous so the first paint's fetches are scoped.
    setActiveCity(parsed.cityName);
    return (
      <BrowserRouter
        basename={parsed.basename}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <App />
      </BrowserRouter>
    );
  }

  // No city in the URL yet — bootstrap UI while we resolve the first city.
  return (
    <div className="min-h-screen bg-surface text-fg antialiased flex items-center justify-center">
      <div className="text-label uppercase tracking-wider text-fg-muted">
        {state.phase === 'loading' && 'Resolving city…'}
        {state.phase === 'empty' && 'No cities are registered on this supervisor.'}
        {state.phase === 'error' && `Could not load cities: ${state.message}`}
      </div>
    </div>
  );
}

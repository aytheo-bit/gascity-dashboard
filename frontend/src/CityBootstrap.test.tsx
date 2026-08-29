import { describe, expect, it, vi } from 'vitest';
import { resolveBootstrapCity } from './CityBootstrap';

describe('resolveBootstrapCity', () => {
  it('prefers the explicitly admitted local Operations Home city', async () => {
    const listSupervisorCities = vi.fn();
    const city = await resolveBootstrapCity({
      fetchLocalCity: vi.fn(async () =>
        new Response(JSON.stringify({ cityName: 'kitflow-node-a' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
      listSupervisorCities,
    });

    expect(city).toBe('kitflow-node-a');
    expect(listSupervisorCities).not.toHaveBeenCalled();
  });

  it('falls back to the supervisor registry when no local city is admitted', async () => {
    const city = await resolveBootstrapCity({
      fetchLocalCity: vi.fn(async () => new Response(null, { status: 404 })),
      listSupervisorCities: vi.fn(async () => ({
        items: [{ name: 'supervisor-city' }],
      })),
    });

    expect(city).toBe('supervisor-city');
  });

  it('fails closed on a malformed admitted city instead of silently choosing another city', async () => {
    const listSupervisorCities = vi.fn(async () => ({ items: [{ name: 'other-city' }] }));
    await expect(
      resolveBootstrapCity({
        fetchLocalCity: vi.fn(async () =>
          new Response(JSON.stringify({ cityName: '../wrong-city' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
        listSupervisorCities,
      }),
    ).rejects.toThrow('invalid local Operations Home city');
    expect(listSupervisorCities).not.toHaveBeenCalled();
  });
});

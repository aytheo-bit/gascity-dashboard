import { describe, expect, it } from 'vitest';
import type { Message } from 'gas-city-dashboard-shared/gc-supervisor';
import { deriveMailAttention } from './mail';

function mail(overrides: Partial<Message>): Message {
  return {
    id: 'mail-1',
    from: 'mayor',
    to: 'human',
    subject: 'ESCALATION: Reaper anomalies detected [MEDIUM]',
    body: 'bulk prune skipped: backup stale',
    created_at: '2026-06-07T12:00:00.000Z',
    read: false,
    ...overrides,
  };
}

describe('mail attention grouping', () => {
  it('presents identical Reaper mail once with count and newest deep link', () => {
    const items = deriveMailAttention({
      nowMs: Date.parse('2026-06-07T12:01:00.000Z'),
      items: [
        mail({ id: 'oldest', created_at: '2026-06-07T10:00:00.000Z' }),
        mail({ id: 'newest', created_at: '2026-06-07T12:00:00.000Z' }),
        mail({ id: 'middle', created_at: '2026-06-07T11:00:00.000Z' }),
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'mail:newest:unread',
      href: '/mail?message=newest',
      updatedAt: '2026-06-07T12:00:00.000Z',
    });
    expect(items[0]?.summary).toContain('3 identical alerts');
    expect(items[0]?.summary).toContain('first 2026-06-07T10:00:00.000Z');
    expect(items[0]?.summary).toContain('latest 2026-06-07T12:00:00.000Z');
  });

  it('does not group an anomaly whose body changed', () => {
    const items = deriveMailAttention({
      items: [
        mail({ id: 'one' }),
        mail({ id: 'two', body: 'bulk prune skipped: evidence path changed' }),
      ],
    });
    expect(items).toHaveLength(2);
  });
});

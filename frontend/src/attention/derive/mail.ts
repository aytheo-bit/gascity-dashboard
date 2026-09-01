import type { Message } from 'gas-city-dashboard-shared/gc-supervisor';
import { groupOperatorActionableUnread } from 'gas-city-dashboard-shared';
import { elapsedSince, formatElapsed } from '../elapsed';
import type { AttentionItem } from '../compose';
import { domainAttention, domainUnavailable, domainWatch, type ReadFreshnessFacts } from './shared';

export interface MailAttentionFacts extends ReadFreshnessFacts {
  items?: readonly Message[];
  nowMs?: number;
  partial?: boolean;
  error?: string;
}

const MAIL_UNREAD_STALE_MS = 24 * 60 * 60 * 1000;

export function deriveMailAttention(
  facts: MailAttentionFacts | undefined,
): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  if (facts === undefined) return items;
  // gascity-dashboard-m1gi: a failed mail READ is a degradation, not actionable
  // mail, so it rides the non-counting `unavailable` tier (see beads above) —
  // visible, but a 503 never inflates the Mail badge.
  if (facts.error !== undefined && facts.error.length > 0) {
    items.push(
      domainUnavailable('mail', {
        id: 'mail:unavailable',
        title: 'Mail data unavailable',
        summary: facts.error,
        href: '/mail',
      }),
    );
  }
  if (facts.partial === true) {
    items.push(
      domainWatch('mail', {
        id: 'mail:partial',
        title: 'Mail list incomplete',
        href: '/mail',
      }),
    );
  }
  const nowMs = facts.nowMs ?? Date.now();
  // The Mail page preserves every raw message. This human-facing attention
  // surface first applies the same needs-you filter, then groups only exact
  // subject/body/to/rig/priority repeats so a recurring anomaly is one signal.
  for (const group of groupOperatorActionableUnread(facts.items ?? [])) {
    const message = group.representative;
    const staleAgeMs = elapsedSince(message.created_at, nowMs);
    const stale = staleAgeMs !== null && staleAgeMs >= MAIL_UNREAD_STALE_MS;
    const repeatSummary =
      group.count > 1
        ? `${group.count} identical alerts · first ${group.oldest.created_at} · latest ${message.created_at} · `
        : '';
    items.push(
      domainAttention('mail', {
        id: `mail:${message.id}:${stale ? 'unread-stale' : 'unread'}`,
        title: message.subject,
        summary: stale
          ? `${repeatSummary}from ${message.from}, unread for ${formatElapsed(staleAgeMs)}`
          : `${repeatSummary}from ${message.from}`,
        href: mailHref(message.id),
        updatedAt: message.created_at,
      }),
    );
  }
  return items;
}

function mailHref(messageId: string): string {
  const search = new URLSearchParams();
  search.set('message', messageId);
  return `/mail?${search.toString()}`;
}

import { isResolvedStatus } from 'gas-city-dashboard-shared';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';

// gascity-dashboard-2j8e.3: the single selector behind the Beads nav badge AND
// the /beads "Needs you" section. It counts beads that genuinely need the
// operator — explicit escalations / help requests — and EXCLUDES ordinary
// unclaimed backlog as well as plain dependency-blocked beads. The operator
// does not claim engineering work: an unassigned Bead is queue state, not a
// request for human action. The badge (registry
// deriveBeadsAttention) and the page both read this projection, so the nav
// count and the page count cannot disagree — the parity contract the Runs badge
// established (selectBlockedRuns, gascity-dashboard-2j8e.2).
//
// Two inputs because they arrive from two reads with opposite filtering:
//  - `beads` is the general engineering-bead list. The dashboard's bead reads
//    drop `gc:`-labelled bookkeeping beads, so escalations never appear here.
//  - `escalations` is the dedicated open-`gc:escalation` queue (the marker the
//    prior `gc dashboard` escalations panel keyed on), fetched separately so the
//    gc:-label filter does not hide it — the same shape as the mayor-decision
//    queue.

/**
 * Why a bead needs the operator. `escalated` is an abnormally-blocked bead that
 * raised the explicit escalation marker. Ordinary unclaimed and dependency-
 * blocked work are queue state, not operator attention.
 */
export type BeadAttentionReason = 'escalated';

/** Explicit escalation acts now. */
export type BeadAttentionSeverity = 'attention';

export interface BeadAttentionRow {
  beadId: string;
  reason: BeadAttentionReason;
  severity: BeadAttentionSeverity;
  /** Operator-facing one-line context, leading with the bead title (why it is here). */
  summary: string;
  /** Movement timestamp used for ordering and aging. */
  updatedAt: string;
}

export interface BeadAttentionInputs {
  /** The general engineering-bead list (gc:-labelled bookkeeping already dropped). */
  beads: readonly Bead[];
  /** The dedicated open-`gc:escalation` queue (help-request / escalation). */
  escalations: readonly Bead[];
}

/**
 * Project the bead reads into the operator-actionable attention set. Pure and
 * deterministic given (inputs, nowMs) — the badge and the page read the same
 * output, so their counts agree by construction.
 */
export function selectBeadsNeedingAttention(
  inputs: BeadAttentionInputs,
  _nowMs: number,
): BeadAttentionRow[] {
  const rows: BeadAttentionRow[] = [];
  for (const bead of inputs.escalations) {
    const row = escalatedRow(bead);
    if (row !== null) rows.push(row);
  }
  return rows;
}

// Escalated / help-requested: an open escalation bead is abnormal blocking —
// counted immediately, regardless of age. A resolved escalation is not.
function escalatedRow(bead: Bead): BeadAttentionRow | null {
  // A resolved escalation no longer needs the operator — accept every terminal
  // spelling (bd closed and the supervisor wire completed/done/failed/skipped)
  // via isResolvedStatus, or a finished escalation lingers in the attention rows.
  if (isResolvedStatus(bead.status)) return null;
  return {
    beadId: bead.id,
    reason: 'escalated',
    severity: 'attention',
    summary: `${bead.title} — escalation raised`,
    updatedAt: bead.updated_at ?? bead.created_at,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  groupOperatorActionableUnread,
  selectOperatorActionableUnread,
} from 'gas-city-dashboard-shared';
import { formatApiError } from '../api/client';
import { formatMailSender } from '../lib/mailSender';
import { useCachedData } from '../hooks/useCachedData';
import { useAttentionModel } from '../attention/context';
import { attentionDataProps, resourceAttentionSeverity } from '../attention/routeHighlight';
import { Button } from '../components/Button';
import { FilterChips } from '../components/FilterChips';
import { GroupedTable } from '../components/GroupedTable';
import { ListSearchBar } from '../components/ListSearchBar';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { type TableColumn } from '../components/Table';
import { AgentPanel } from '../components/AgentPanel';
import { ComposeModal } from '../components/mail/ComposeModal';
import { ThreadMessage } from '../components/mail/ThreadMessage';
import { Field } from '../components/Field';
import { useNow } from '../contexts/NowContext';
import { useOperatorConfig } from '../contexts/OperatorConfigContext';
import { READ_ONLY_CONTROL_TITLE, ReadOnlyBadge, useReadOnly } from '../contexts/ReadOnlyContext';
import { useViewingAs } from '../contexts/ViewingAsContext';
import { displayLabel } from '../hooks/aliasPriority';
import { useListFilters, type FilterChip } from '../hooks/useListFilters';
import { mailProject } from '../hooks/projectOf';
import { formatRelative } from '../hooks/time';
import {
  DEFAULT_MAIL_HISTORY_LIMIT,
  DEFAULT_MAIL_HISTORY_WINDOW,
  fetchSupervisorMailThread,
  listSupervisorMail,
  MAIL_HISTORY_LIMITS,
  MAIL_HISTORY_WINDOWS,
  type MailHistoryLimit,
  type MailHistoryWindow,
  type SupervisorMailItem,
} from '../supervisor/mailReads';
import {
  archiveSupervisorMail,
  markSupervisorMailRead,
  markSupervisorMailUnread,
  replySupervisorMail,
} from '../supervisor/mailWrites';

// Mail chips operate on read-state. "Sent" box has no unread concept;
// the chips still render but their match predicates are box-aware.
const MAIL_CHIPS: ReadonlyArray<FilterChip<SupervisorMailItem>> = [
  { id: 'unread', label: 'unread', match: (m) => !m.read },
  { id: 'read', label: 'read', match: (m) => m.read },
];

const MAIL_SEARCH_FIELDS = (m: SupervisorMailItem): ReadonlyArray<string | undefined> => [
  m.from,
  m.to,
  m.subject,
  m.rig,
  // First body line only — out-of-scope per bead description to search
  // full bodies; matching the preview keeps parity with what the table
  // already renders.
  m.body.split('\n')[0],
];

type MailBox = 'needs-you' | 'inbox' | 'sent' | 'all';
type MailAction = 'archive' | 'read' | 'reply' | 'unread';
const DEEP_LINK_MAIL_HISTORY_LIMIT: MailHistoryLimit = 1000;

interface MailRecurrence {
  count: number;
  firstId: string;
  firstAt: string;
  latestId: string;
  latestAt: string;
}

type PresentedMailItem = SupervisorMailItem & { recurrence?: MailRecurrence };

export function presentNeedsYouMail(
  items: readonly SupervisorMailItem[],
): readonly PresentedMailItem[] {
  return groupOperatorActionableUnread(items).map(({ representative, oldest, count }) => ({
    ...representative,
    ...(count > 1 && {
      recurrence: {
        count,
        firstId: oldest.id,
        firstAt: oldest.created_at,
        latestId: representative.id,
        latestAt: representative.created_at,
      },
    }),
  }));
}

export function MailPage() {
  const attention = useAttentionModel();
  const readOnly = useReadOnly();
  const operator = useOperatorConfig();
  const [searchParams] = useSearchParams();
  const selectedMessageParam = normalizeSelectedMessageParam(searchParams.get('message'));
  const {
    viewingAs,
    setAlias,
    resetToOperator,
    aliasBuckets,
    aliasesLoading,
    sessionsUnavailable,
    loadAliases,
  } = useViewingAs();
  const [box, setBox] = useState<MailBox>(() =>
    selectedMessageParam === null ? 'needs-you' : 'all',
  );
  const [historyLimit, setHistoryLimit] = useState<MailHistoryLimit>(() =>
    selectedMessageParam === null ? DEFAULT_MAIL_HISTORY_LIMIT : DEEP_LINK_MAIL_HISTORY_LIMIT,
  );
  const [historyWindow, setHistoryWindow] = useState<MailHistoryWindow>(
    DEFAULT_MAIL_HISTORY_WINDOW,
  );

  // Lazy alias prefetch — Mail is the only consumer of the dropdown, so
  // non-Mail routes don't pay the cost (code-reviewer HIGH-1). Idempotent
  // on the context side, so re-entries are no-ops.
  useEffect(() => {
    loadAliases();
  }, [loadAliases]);
  const now = useNow();

  const {
    data: mailData,
    loading,
    error: mailError,
    refresh,
  } = useCachedData(
    `mail:${box}:${viewingAs.alias}:${operator.operatorWireAlias}:${historyLimit}:${historyWindow}`,
    () =>
      listSupervisorMail(
        box === 'needs-you' ? 'inbox' : box,
        viewingAs.alias,
        operator,
        historyLimit,
        historyWindow,
        now,
      ),
  );
  const items = useMemo(() => mailData?.items ?? [], [mailData]);
  const presentedItems = useMemo<readonly PresentedMailItem[]>(
    () => (box === 'needs-you' ? presentNeedsYouMail(items) : items),
    [box, items],
  );
  const [error, setError] = useState<string | null>(null);
  // Surface fetch errors from the cached hook through the same state
  // local handlers use, so the existing error banner keeps working.
  useEffect(() => {
    if (mailError) setError(mailError);
  }, [mailError]);

  const [threadFor, setThreadFor] = useState<SupervisorMailItem | null>(null);
  const [threadItems, setThreadItems] = useState<SupervisorMailItem[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const openedMessageParam = useRef<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [actionInFlight, setActionInFlight] = useState<MailAction | null>(null);

  const [composing, setComposing] = useState(false);

  useEffect(() => {
    if (!viewingAs.isOperator && box === 'needs-you') setBox('inbox');
  }, [box, viewingAs.isOperator]);

  // Bulk read-state selection (gascity-dashboard-mp3g). Lives in component
  // state only; switching mailbox or reading-as identity clears it (different
  // working set). Bulk marks reuse the same per-item supervisor writes the
  // thread modal uses, then refresh() so the needs-you count — and the nav
  // badge, which reads the same selectOperatorActionableUnread — stay in step.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkInFlight, setBulkInFlight] = useState<'read' | 'unread' | null>(null);

  const openThread = useCallback(
    async (mail: SupervisorMailItem) => {
      setThreadFor(mail);
      setThreadItems([]);
      setReplyBody('');
      setError(null);
      if (!mail.thread_id) return;
      setThreadLoading(true);
      try {
        const data = await fetchSupervisorMailThread(
          mail.thread_id,
          viewingAs.alias,
          operator,
          historyLimit,
        );
        setThreadItems(data.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'thread failed');
      } finally {
        setThreadLoading(false);
      }
    },
    [historyLimit, viewingAs.alias, operator],
  );

  useEffect(() => {
    if (selectedMessageParam === null) {
      openedMessageParam.current = null;
      return;
    }
    if (openedMessageParam.current === selectedMessageParam) return;
    const selectedMessage = items.find((mail) => mail.id === selectedMessageParam);
    if (selectedMessage === undefined) return;
    openedMessageParam.current = selectedMessageParam;
    void openThread(selectedMessage);
  }, [items, openThread, selectedMessageParam]);

  const runMailAction = useCallback(
    async (action: MailAction) => {
      const message = threadFor;
      if (message === null) return;
      // Defense-in-depth: the disabled buttons already block this, but a
      // keyboard/programmatic path must never reach a write the server 405s.
      if (readOnly) return;
      setActionInFlight(action);
      setError(null);
      try {
        if (action === 'read') {
          await markSupervisorMailRead(message);
          setThreadFor({ ...message, read: true });
        } else if (action === 'unread') {
          await markSupervisorMailUnread(message);
          setThreadFor({ ...message, read: false });
        } else if (action === 'archive') {
          await archiveSupervisorMail(message);
          setThreadFor(null);
          setThreadItems([]);
        } else {
          const body = replyBody.trim();
          if (body.length === 0) return;
          await replySupervisorMail(message, { body }, operator.operatorWireAlias);
          setReplyBody('');
          if (message.thread_id) {
            const data = await fetchSupervisorMailThread(
              message.thread_id,
              viewingAs.alias,
              operator,
              historyLimit,
            );
            setThreadItems(data.items);
          }
        }
        await refresh();
      } catch (err) {
        setError(formatApiError(err, `${action} failed`));
      } finally {
        setActionInFlight(null);
      }
    },
    [historyLimit, readOnly, refresh, replyBody, threadFor, viewingAs.alias, operator],
  );

  const columns = useMemo<ReadonlyArray<TableColumn<PresentedMailItem>>>(
    () => [
      {
        key: 'from',
        label: 'From',
        sortable: true,
        sortValue: (r) => formatMailSender(r.from),
        render: (r) => <span className="text-fg-muted">{formatMailSender(r.from)}</span>,
        className: 'w-48',
      },
      {
        key: 'subject',
        label: 'Subject',
        sortable: true,
        sortValue: (r) => r.subject,
        render: (r) => (
          <div className="min-w-0">
            <p className={`truncate ${r.read ? 'text-fg-muted' : 'text-fg font-medium'}`}>
              {r.subject}
            </p>
            <p className="text-label uppercase tracking-wider text-fg-faint mt-1 truncate">
              {r.body.split('\n')[0] ?? ''}
            </p>
            {r.recurrence !== undefined && (
              <p className="text-label uppercase tracking-wider text-accent mt-1 truncate">
                {r.recurrence.count} repeats · first {formatRelative(r.recurrence.firstAt, now)}
              </p>
            )}
          </div>
        ),
      },
      {
        key: 'created_at',
        label: 'When',
        sortable: true,
        sortValue: (r) => r.created_at,
        render: (r) => (
          <span className="tnum text-fg-muted">{formatRelative(r.created_at, now)}</span>
        ),
        className: 'w-24',
        align: 'right',
      },
    ],
    [now],
  );

  const aliasLabel = useMemo(
    () => displayLabel(viewingAs.alias, operator.operatorAlias),
    [viewingAs.alias, operator.operatorAlias],
  );

  // gascity-dashboard-2j8e.5: the operator inbox's needs-you count — the same
  // selectOperatorActionableUnread the Mail nav badge reads, so the count and
  // the badge agree on the default operator inbox (the badge's canonical
  // source). Only meaningful on the operator's own inbox — it is their signal.
  const needsYou = useMemo(
    () => (viewingAs.isOperator ? selectOperatorActionableUnread(items).length : 0),
    [items, viewingAs.isOperator],
  );

  const synopsis = useMemo(() => {
    const noun = box === 'all' ? 'all mail' : box === 'needs-you' ? 'needs-you mail' : box;
    if (items.length === 0) return `${capitalize(noun)} empty for ${aliasLabel}.`;
    if (box === 'needs-you') {
      return needsYou > 0
        ? `${presentedItems.length} attention group${presentedItems.length === 1 ? '' : 's'} from ${needsYou} actionable message${needsYou === 1 ? '' : 's'}. Inbox and All preserve every raw message.`
        : `No mail needs you. Inbox and All preserve every raw message.`;
    }
    const unread = box === 'sent' ? 0 : items.filter((m) => !m.read).length;
    if (box === 'inbox' && viewingAs.isOperator) {
      // Foreground the needs-you count and name the folded pool-worker firehose
      // (unread − needsYou) so the smaller badge number is legible, not a mystery.
      if (unread === 0) return `${items.length} in inbox, all read.`;
      return needsYou > 0
        ? `${items.length} in inbox, ${needsYou} need you of ${unread} unread.`
        : `${items.length} in inbox, ${unread} unread, none need you.`;
    }
    if (unread > 0) return `${items.length} in ${noun}, ${unread} unread.`;
    return `${items.length} in ${noun}.`;
  }, [box, items, presentedItems.length, aliasLabel, needsYou, viewingAs.isOperator]);

  const mailChips = MAIL_CHIPS;

  // Mail view key includes box so collapsed-project state is independent
  // between inbox and sent (different mental models).
  const filters = useListFilters<PresentedMailItem>({
    viewKey: `mail:${box}`,
    rows: presentedItems,
    projectOf: mailProject,
    searchOf: MAIL_SEARCH_FIELDS,
    chips: mailChips,
  });

  // Sent mail has no read-state to manage, so bulk selection is offered only on
  // inbox / all — the same boxes that surface the read-state chips.
  const selectable = box !== 'sent' && box !== 'needs-you';
  const visibleRows = useMemo(() => filters.groups.flatMap((g) => g.rows), [filters.groups]);
  const selectedCount = useMemo(
    () => visibleRows.reduce((n, r) => (selectedIds.has(r.id) ? n + 1 : n), 0),
    [visibleRows, selectedIds],
  );
  const allSelected = visibleRows.length > 0 && selectedCount === visibleRows.length;

  useEffect(() => {
    setSelectedIds(new Set<string>());
  }, [box, viewingAs.alias]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(allSelected ? new Set<string>() : new Set(visibleRows.map((r) => r.id)));
  }, [allSelected, visibleRows]);

  const runBulkMark = useCallback(
    async (read: boolean) => {
      if (readOnly) return;
      // Only write rows whose state actually changes — never re-mark a row that
      // is already in the target state (DESIGN.md: no second mark).
      const targets = visibleRows.filter((r) => selectedIds.has(r.id) && r.read !== read);
      if (targets.length === 0) return;
      setBulkInFlight(read ? 'read' : 'unread');
      setError(null);
      try {
        await Promise.all(
          targets.map((m) => (read ? markSupervisorMailRead(m) : markSupervisorMailUnread(m))),
        );
        setSelectedIds(new Set<string>());
      } catch (err) {
        setError(formatApiError(err, `bulk mark ${read ? 'read' : 'unread'} failed`));
      } finally {
        setBulkInFlight(null);
        // Re-read so the table, the needs-you synopsis, and the nav badge all
        // reflect server truth — even when a subset of the writes failed.
        await refresh();
      }
    },
    [readOnly, visibleRows, selectedIds, refresh],
  );

  const selectColumn = useMemo<TableColumn<PresentedMailItem>>(
    () => ({
      key: '__select',
      label: '',
      className: 'w-8',
      render: (r) => (
        <input
          type="checkbox"
          className="h-3.5 w-3.5 translate-y-[2px] cursor-pointer accent-fg focus-mark"
          checked={selectedIds.has(r.id)}
          onChange={() => toggleSelect(r.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`select mail: ${r.subject}`}
        />
      ),
    }),
    [selectedIds, toggleSelect],
  );
  const tableColumns = selectable ? [selectColumn, ...columns] : columns;
  // gascity-dashboard-s464: mail is not an alert by default. We keep the
  // data-attention-severity attribute (so the home-alerts panel and
  // keyboard nav still see flagged rows), but DO NOT paint the warn/accent
  // background tint that made unread mail read as "slightly red". Mail rows
  // render in the neutral foreground; severity is exposed for tooling only.
  const rowProps = useMemo(
    () => (mail: PresentedMailItem) =>
      attentionDataProps(resourceAttentionSeverity(attention, 'mail', mail.id)),
    [attention],
  );
  const mailSeverity = useCallback(
    (mail: PresentedMailItem) => resourceAttentionSeverity(attention, 'mail', mail.id),
    [attention],
  );

  // Sent box has no unread concept; suppress those chips there.
  const visibleChips = box === 'sent' || box === 'needs-you' ? [] : mailChips;
  const replyDisabled =
    readOnly ||
    threadFor === null ||
    replyBody.trim().length === 0 ||
    actionInFlight !== null ||
    !viewingAs.isOperator;

  return (
    <section>
      <PageHeader
        title="Mail"
        synopsis={synopsis}
        meta={
          <>
            {error && (
              <span className="normal-case text-body text-accent" role="alert">
                {error}
              </span>
            )}
            {readOnly && <ReadOnlyBadge />}
            <Button
              size="sm"
              onClick={() => setComposing(true)}
              disabled={readOnly || !viewingAs.isOperator}
              title={
                readOnly
                  ? READ_ONLY_CONTROL_TITLE
                  : viewingAs.isOperator
                    ? 'Compose a new message (sends as the operator)'
                    : 'Switch back to the operator to compose'
              }
            >
              Compose
            </Button>
            <Button size="sm" onClick={() => void refresh()} disabled={loading}>
              {loading ? 'Refreshing' : 'Refresh'}
            </Button>
          </>
        }
      />

      {/* Below sm the reading-as rail stacks above the list; its divider
          rotates from right-edge rule to bottom rule in AgentPanel. */}
      <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
        <AgentPanel
          buckets={aliasBuckets}
          loading={aliasesLoading}
          sessionsUnavailable={sessionsUnavailable}
          value={viewingAs.alias}
          onChange={setAlias}
          onReset={resetToOperator}
          isOperator={viewingAs.isOperator}
        />

        <div className="flex-1 min-w-0">
          <div className="mb-6">
            <BoxTabs box={box} onChange={setBox} showNeedsYou={viewingAs.isOperator} />
          </div>

          <div className="mb-6 space-y-3">
            <ListSearchBar
              value={filters.search}
              onChange={filters.setSearch}
              placeholder="Search mail by sender, subject, rig"
              matchCount={filters.totalMatches}
              totalCount={presentedItems.length}
              ariaLabel="Search mail"
            />
            {visibleChips.length > 0 && (
              <div className="flex items-baseline justify-between gap-4 flex-wrap">
                <FilterChips
                  chips={visibleChips}
                  activeIds={filters.activeChipIds}
                  onToggle={filters.toggleChip}
                  legend="Read state"
                />
                <MailHistoryControls
                  limit={historyLimit}
                  onLimitChange={setHistoryLimit}
                  onWindowChange={setHistoryWindow}
                  window={historyWindow}
                />
              </div>
            )}
            {visibleChips.length === 0 && (
              <div className="flex justify-end">
                <MailHistoryControls
                  limit={historyLimit}
                  onLimitChange={setHistoryLimit}
                  onWindowChange={setHistoryWindow}
                  window={historyWindow}
                />
              </div>
            )}
          </div>

          {selectable && visibleRows.length > 0 && (
            <div className="mb-6">
              <MailSelectionBar
                selectedCount={selectedCount}
                allSelected={allSelected}
                onToggleAll={toggleSelectAll}
                onMarkRead={() => void runBulkMark(true)}
                onMarkUnread={() => void runBulkMark(false)}
                bulkInFlight={bulkInFlight}
                readOnly={readOnly}
              />
            </div>
          )}

          <GroupedTable
            groups={filters.groups}
            columns={tableColumns}
            rowKey={(r) => r.id}
            onToggleProject={filters.toggleProject}
            onRowClick={(r) => void openThread(r)}
            rowProps={rowProps}
            emptyMessage={
              filters.search.length > 0 || filters.activeChipIds.size > 0
                ? 'No messages match the current search or filter.'
                : `${box === 'needs-you' ? 'Needs you' : capitalize(box)} empty for ${aliasLabel}.`
            }
            perProjectEmpty="No messages in this project."
            initialSort={{ key: 'created_at', dir: 'desc' }}
          />
        </div>
      </div>

      <Modal
        open={threadFor !== null}
        onClose={() => setThreadFor(null)}
        title={threadFor?.subject ?? 'Thread'}
        caption={`Reading as ${aliasLabel}, ${threadItems.length} message(s)`}
        widthClass="max-w-3xl"
        footer={
          threadFor === null ? null : (
            <>
              <Button
                tone="quiet"
                size="sm"
                title={readOnly ? READ_ONLY_CONTROL_TITLE : undefined}
                disabled={readOnly || actionInFlight !== null}
                onClick={() => void runMailAction(threadFor.read ? 'unread' : 'read')}
              >
                {threadFor.read ? 'Mark unread' : 'Mark read'}
              </Button>
              <Button
                tone="quiet"
                size="sm"
                title={readOnly ? READ_ONLY_CONTROL_TITLE : undefined}
                disabled={readOnly || actionInFlight !== null}
                onClick={() => void runMailAction('archive')}
              >
                {actionInFlight === 'archive' ? 'Archiving' : 'Archive'}
              </Button>
              <Button
                tone="accent"
                size="sm"
                title={readOnly ? READ_ONLY_CONTROL_TITLE : undefined}
                disabled={replyDisabled}
                onClick={() => void runMailAction('reply')}
              >
                {actionInFlight === 'reply' ? 'Replying' : 'Reply'}
              </Button>
            </>
          )
        }
      >
        <div className="space-y-6">
          {threadLoading ? (
            <p className="text-fg-muted italic">Loading thread.</p>
          ) : threadItems.length === 0 && threadFor ? (
            <ThreadMessage message={threadFor} attentionSeverity={mailSeverity(threadFor)} />
          ) : (
            <ol className="space-y-6">
              {threadItems.map((m) => (
                <li key={m.id}>
                  <ThreadMessage message={m} attentionSeverity={mailSeverity(m)} />
                </li>
              ))}
            </ol>
          )}
          {threadFor !== null && (
            <Field label="Reply" variant="form">
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                rows={5}
                maxLength={16 * 1024}
                title={readOnly ? READ_ONLY_CONTROL_TITLE : undefined}
                disabled={readOnly || !viewingAs.isOperator}
                className="w-full bg-surface-tint border border-rule rounded-sm px-3 py-2 text-body text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40 resize-y disabled:opacity-50"
              />
            </Field>
          )}
        </div>
      </Modal>

      <ComposeModal
        open={composing}
        onClose={() => setComposing(false)}
        onSent={() => {
          setComposing(false);
          if (box === 'sent') void refresh();
        }}
      />
    </section>
  );
}

function BoxTabs({
  box,
  onChange,
  showNeedsYou,
}: {
  box: MailBox;
  onChange: (b: MailBox) => void;
  showNeedsYou: boolean;
}) {
  const boxes: MailBox[] = showNeedsYou
    ? ['needs-you', 'inbox', 'sent', 'all']
    : ['inbox', 'sent', 'all'];
  return (
    <div className="flex items-baseline gap-6">
      {boxes.map((b) => (
        <button
          key={b}
          type="button"
          onClick={() => onChange(b)}
          className={`text-title transition-colors duration-150 ease-out-quart focus-mark rounded-sm ${
            box === b ? 'text-fg font-semibold' : 'text-fg-muted hover:text-fg'
          }`}
        >
          {b === 'all' ? 'All' : b === 'needs-you' ? 'Needs you' : capitalize(b)}
        </button>
      ))}
    </div>
  );
}

// Editorial bulk-action line (gascity-dashboard-mp3g): a select-all affordance
// and the read-state writes for the selected set, on one hairline-ruled row.
// Flat page register — no card, no sticky toolbar; words on every action so the
// row reads in greyscale (DESIGN.md §States).
function MailSelectionBar({
  selectedCount,
  allSelected,
  onToggleAll,
  onMarkRead,
  onMarkUnread,
  bulkInFlight,
  readOnly,
}: {
  selectedCount: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  bulkInFlight: 'read' | 'unread' | null;
  readOnly: boolean;
}) {
  const allRef = useRef<HTMLInputElement>(null);
  const someSelected = selectedCount > 0;
  useEffect(() => {
    if (allRef.current !== null) allRef.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);
  const busy = bulkInFlight !== null;
  const title = readOnly ? READ_ONLY_CONTROL_TITLE : undefined;
  return (
    <div
      className="flex items-baseline justify-between gap-4 flex-wrap border-b border-rule pb-3"
      role="region"
      aria-label="bulk mail selection"
    >
      <label className="flex items-baseline gap-2 text-label uppercase tracking-wider text-fg-muted cursor-pointer">
        <input
          ref={allRef}
          type="checkbox"
          className="h-3.5 w-3.5 translate-y-[2px] cursor-pointer accent-fg focus-mark"
          checked={allSelected}
          onChange={onToggleAll}
          aria-label="select all mail"
        />
        <span>{someSelected ? `${selectedCount} selected` : 'Select all'}</span>
      </label>
      {someSelected && (
        <div className="flex items-baseline gap-3">
          {readOnly && <ReadOnlyBadge />}
          <Button
            size="sm"
            tone="quiet"
            onClick={onMarkRead}
            disabled={readOnly || busy}
            title={title}
          >
            {bulkInFlight === 'read' ? 'Marking' : 'Mark read'}
          </Button>
          <Button
            size="sm"
            tone="quiet"
            onClick={onMarkUnread}
            disabled={readOnly || busy}
            title={title}
          >
            {bulkInFlight === 'unread' ? 'Marking' : 'Mark unread'}
          </Button>
        </div>
      )}
    </div>
  );
}

function MailHistoryControls({
  limit,
  onLimitChange,
  onWindowChange,
  window,
}: {
  limit: MailHistoryLimit;
  onLimitChange: (value: MailHistoryLimit) => void;
  onWindowChange: (value: MailHistoryWindow) => void;
  window: MailHistoryWindow;
}) {
  return (
    <div className="flex items-baseline gap-3 flex-wrap">
      <label className="flex items-baseline gap-2 text-label uppercase tracking-wider text-fg-muted">
        <span>Window</span>
        <select
          aria-label="Mail time window"
          value={window}
          onChange={(e) => onWindowChange(toMailHistoryWindow(e.target.value))}
          className="bg-transparent border border-rule rounded-sm px-2 py-1 text-label uppercase tracking-wider text-fg-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
        >
          {MAIL_HISTORY_WINDOWS.map((historyWindow) => (
            <option key={historyWindow} value={historyWindow}>
              {mailWindowLabel(historyWindow)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-baseline gap-2 text-label uppercase tracking-wider text-fg-muted">
        <span>History</span>
        <select
          aria-label="Mail history limit"
          value={limit}
          onChange={(e) => onLimitChange(toMailHistoryLimit(e.target.value))}
          className="bg-transparent border border-rule rounded-sm px-2 py-1 text-label uppercase tracking-wider text-fg-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
        >
          {MAIL_HISTORY_LIMITS.map((historyLimit) => (
            <option key={historyLimit} value={historyLimit}>
              Recent {historyLimit}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function toMailHistoryLimit(value: string): MailHistoryLimit {
  const parsed = Number(value);
  return MAIL_HISTORY_LIMITS.includes(parsed as MailHistoryLimit)
    ? (parsed as MailHistoryLimit)
    : DEFAULT_MAIL_HISTORY_LIMIT;
}

function toMailHistoryWindow(value: string): MailHistoryWindow {
  return MAIL_HISTORY_WINDOWS.includes(value as MailHistoryWindow)
    ? (value as MailHistoryWindow)
    : DEFAULT_MAIL_HISTORY_WINDOW;
}

function mailWindowLabel(window: MailHistoryWindow): string {
  if (window === '24h') return 'Last 24h';
  if (window === '7d') return 'Last 7d';
  return 'All time';
}

function normalizeSelectedMessageParam(value: string | null): string | null {
  const clean = value?.trim();
  return clean && clean.length > 0 ? clean : null;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

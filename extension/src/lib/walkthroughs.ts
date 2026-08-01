import type { WorkspaceLink } from './types';

/**
 * The workspace's own queue, read back into the recorder.
 *
 * `GET /api/ingest/walkthroughs` is the agent-facing list (the same call MCP's
 * `list_walkthroughs` makes), and the panel's home screen shows the top of it:
 * what has already been handed over, what state it's in, and where it went. It
 * is a read of somebody else's surface — nothing here is load-bearing, so a
 * failure is a quiet line with a retry, never an error state.
 */

export const WALKTHROUGH_STATUSES = ['open', 'in_review', 'resolved'] as const;
export type WalkthroughStatus = (typeof WALKTHROUGH_STATUSES)[number];

/** One row of the workspace's queue, in the shapes the panel actually renders. */
export interface WorkspaceWalkthrough {
  id: string;
  slug: string;
  title: string;
  origin: string | null;
  status: WalkthroughStatus;
  /** ms — the server sends an ISO string, and every clock in the panel is a number. */
  recordedAt: number;
  durationMs: number;
  frameCount: number;
  errorCount: number;
  takeCount: number;
  projectName: string | null;
  workspace: string;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isStatus(value: unknown): value is WalkthroughStatus {
  return WALKTHROUGH_STATUSES.some((s) => s === value);
}

/**
 * One row, or null if it isn't one. Unlike `context.ts` — where a bad shape means
 * the token can't be trusted and the whole answer is thrown away — a single
 * unreadable row here just doesn't get drawn: the rest of the queue is still
 * worth showing. A status the panel doesn't know is one of those (there are
 * exactly three, and ui.md forbids a fourth).
 */
function readRow(value: unknown): WorkspaceWalkthrough | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const id = str(row.id);
  const slug = str(row.slug);
  const recordedAt = str(row.recordedAt);
  if (id === null || slug === null || recordedAt === null || !isStatus(row.status)) return null;
  const at = Date.parse(recordedAt);
  return {
    id,
    slug,
    title: str(row.title) || slug,
    origin: str(row.origin),
    status: row.status,
    recordedAt: Number.isFinite(at) ? at : 0,
    durationMs: num(row.durationMs),
    frameCount: num(row.frameCount),
    errorCount: num(row.errorCount),
    takeCount: num(row.takeCount),
    projectName: str(row.projectName),
    workspace: str(row.workspace) ?? '',
  };
}

export async function fetchWalkthroughs(
  link: Pick<WorkspaceLink, 'serverUrl' | 'apiToken'>,
  signal?: AbortSignal,
): Promise<WorkspaceWalkthrough[]> {
  const server = link.serverUrl.trim().replace(/\/+$/, '');
  const res = await fetch(`${server}/api/ingest/walkthroughs`, {
    headers: { authorization: `Bearer ${link.apiToken.trim()}` },
    signal,
  });
  if (!res.ok) throw new Error(`walkthroughs failed (${res.status})`);
  const payload: unknown = await res.json();
  if (!Array.isArray(payload)) throw new Error('walkthroughs: not a list');
  const rows: WorkspaceWalkthrough[] = [];
  for (const raw of payload) {
    const row = readRow(raw);
    if (row) rows.push(row);
  }
  return rows;
}

/** Where the workspace shows one — the viewer the recorder hands people off to. */
export function walkthroughUrl(serverUrl: string, id: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/walkthroughs/${id}`;
}

/** The workspace's inbox — every walkthrough, not just the ten the panel lists. */
export function inboxUrl(serverUrl: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/app`;
}

import type { WorkspaceLink } from './types';

/**
 * What one token can see: who it belongs to, and the projects a gripe may be
 * pinned to. The panel asks once per link and uses the answer for two things —
 * naming the workspace in the destination row, and filling the project picker.
 * Nothing here is load-bearing: a failed fetch just leaves the gripe to the
 * workspace's own origin routing.
 */

/** What GET /api/ingest/context says a token can see. */
export interface WorkspaceContext {
  org: { id: string; name: string; slug: string };
  projects: { id: string; name: string; slug: string; originHints: string[] }[];
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readOrg(value: unknown): WorkspaceContext['org'] | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, name, slug } = value as { id?: unknown; name?: unknown; slug?: unknown };
  const [i, n, s] = [str(id), str(name), str(slug)];
  return i !== null && n !== null && s !== null ? { id: i, name: n, slug: s } : null;
}

function readProjects(value: unknown): WorkspaceContext['projects'] | null {
  if (!Array.isArray(value)) return null;
  const out: WorkspaceContext['projects'] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null;
    const { id, name, slug, originHints } = raw as {
      id?: unknown;
      name?: unknown;
      slug?: unknown;
      originHints?: unknown;
    };
    const [i, n, s] = [str(id), str(name), str(slug)];
    if (i === null || n === null || s === null) return null;
    const hints = Array.isArray(originHints)
      ? originHints.filter((h): h is string => typeof h === 'string')
      : [];
    out.push({ id: i, name: n, slug: s, originHints: hints });
  }
  return out;
}

export async function fetchContext(
  link: Pick<WorkspaceLink, 'serverUrl' | 'apiToken'>,
): Promise<WorkspaceContext> {
  const server = link.serverUrl.trim().replace(/\/+$/, '');
  const res = await fetch(`${server}/api/ingest/context`, {
    headers: { authorization: `Bearer ${link.apiToken.trim()}` },
  });
  if (!res.ok) throw new Error(`context failed (${res.status})`);
  const payload: unknown = await res.json();
  if (typeof payload !== 'object' || payload === null) throw new Error('context: not an object');
  const { org, projects } = payload as { org?: unknown; projects?: unknown };
  const readOrgResult = readOrg(org);
  const readProjectsResult = readProjects(projects);
  if (!readOrgResult || !readProjectsResult) throw new Error('context: unexpected shape');
  return { org: readOrgResult, projects: readProjectsResult };
}

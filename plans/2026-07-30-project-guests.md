# Project-scoped guest access

**Status: done** · 2026-07-30 — shipped same day; quality-gate fixes folded in (guest-filtered
members list, token revocation on member removal).

Owner request: "create projects and invite people to be part of my project and they can see my
project's stuff." Projects and org-wide invites already existed; what was missing is inviting
someone to *one project* without showing them the whole workspace.

## Settled design

- `Membership.scope` — `"org"` (default; sees everything — every pre-existing row) or
  `"projects"` (a **guest**: sees only granted projects, effective role always `member`).
- `ProjectAccess(membershipId, projectId)` — the grants behind a guest membership; cascade on
  both sides; unique per pair.
- `Invite.projectId?` — set = guest invite (role forced to `member`). Accept semantics:
  - no membership → create guest membership + grant
  - existing guest → upsert the grant (multi-project guests via multiple invites)
  - existing org member → no-op (already sees it)
  - org-wide invite accepted by a guest → upgrade to `scope: "org"`, grants deleted
- `requireMembership` now returns `Access { role, projectIds: string[] | null }` (null =
  unrestricted); guests are clamped to rank `member` regardless of stored role. Helpers:
  `requireOrgScope(access)` and `canSeeGripe(access, projectId)`.
- Guests **can**: list/view their projects' gripes, presign files, set gripe status (the review
  loop), see the members list. Guests **cannot**: see unassigned (`projectId: null`) gripes,
  create projects, reassign or delete gripes, create invites, or mint API tokens (`hb_` tokens
  read the whole org via /api/ingest — a guest token would leak).
- UI: Team invite form gains an "Access" select (Entire workspace | \<project\> only); tokens tab
  hidden for guests; members list shows a `guest` chip + "Only: \<projects\>"; Projects page has a
  per-row Invite button (link invite + copy field) and hides New-project for guests; /join shows
  the project name; viewer hides the project-assign select for guests.

## Out of scope (deliberately)

Editing an existing guest's project set from the members list (remove + re-invite instead),
per-project roles, guest-visible unassigned gripes, project-scoped API tokens.

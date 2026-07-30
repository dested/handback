# Inloop → Handback rename

- **Date:** 2026-07-30
- **Status:** active
- **Type:** plan
- **What:** Full rebrand to **Handback** at **handback.dev** — code, extension, docs, infra
  handoff. Sal bought the domain 2026-07-30.

## Decisions (settled)

| Was | Is |
| --- | --- |
| Inloop / `inloop` | Handback / `handback` |
| inloop.dested.com | **handback.dev** |
| token prefix `ilp_` | **`hb_`** (old dev tokens die; re-run dev-bootstrap) |
| `INLOOP_TOKEN` / `INLOOP_SERVER` | `HANDBACK_TOKEN` / `HANDBACK_SERVER` |
| S3 bucket `inloop-files` | **`handback-files`** (new bucket — Drydock provisions it, see below) |
| IndexedDB `inloop-recorder` | `handback-recorder` (local recordings orphaned; nobody has real ones) |
| localStorage `inloop.activeOrgId` | `handback.activeOrgId` |
| e2e DB `inloop_test` | `handback_test` |
| MCP name `inloop` | `handback` |
| GitHub dested/inloop | dested/handback (redirect keeps old clones working) |
| logo: interlocked circles | **mark A "the return"** — ink stroke out, cobalt U-turn back with arrowhead |

Copy: title `Handback — agents fix it, humans sign off`; hero stamp `SIGNED OFF BY A HUMAN`;
headline `Your agents ship. The last word is yours.`; footer `Every fix, handed back.`;
final CTA `Nothing ships without you.`

Local folder stays `G:\code\inloop` for now (Sal deferred).

## Sal's side (Drydock portal + DNS) — checklist

1. **Zone**: create/adopt `handback.dev` hosted zone (portal will create it when the project's
   dnsZone is set); delegate NS at the .dev registrar.
2. **S3**: build + run `G:\code\drydock\plans\2026-07-30-s3-buckets.md` (Drydock provisions
   per-project buckets). For handback: bucket `handback-files`, extra CORS origin
   `chrome-extension://*`. Until then dev uploads 403 — local `.env` already points at
   `handback-files`.
3. **Project**: no prod users, so cleanest is destroy `inloop` project + create `handback`
   (fresh db) against the renamed repo, domain `handback.dev`, size m, port 3995. Re-wire commits
   fresh Dockerfile/workflow/drydock.yaml (they still say inloop — they're Drydock-owned, we did
   not touch them).
4. **SSM env**: `BETTER_AUTH_URL=https://handback.dev`; S3 vars from the new provisioning (or
   copy `handback-files` keys by hand until the feature exists); optional `GROQ_API_KEY`.
5. **Cleanup** (whenever): delete bucket `inloop-files` + IAM user `inloop-app`, drop the
   `inloop.dested.com` A record + old Drydock project.

## Repo side (this session)

- 3 Opus agents swept server/cli/config, src/*, extension/* per literal spec.
- Fable: logo mark A wired (logo.tsx, return-diagram, extension icons), locks refreshed,
  `.env` updated, GitHub repo renamed, docs kit updated, typecheck.
- e2e screenshots need re-baselining (`test:e2e:update`) — wordmark changed.

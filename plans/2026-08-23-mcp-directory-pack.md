# MCP directory pack — every listing, ready to paste

- **Date:** 2026-08-23
- **Status:** active
- **Type:** notes
- **What:** Drafted submissions for every MCP directory/registry; owner pastes/submits. Tick each off with the live listing URL.

---

## Canonical copy block (reuse across every listing)

Keep these strings identical everywhere — same name, same tagline, same endpoint. Trim to a
target's fields, never reword.

**Name:** `Handback`

**One-liner:** Turn narrated screen recordings of bugs into repro-grade briefs your coding agent pulls, fixes, and hands back for human sign-off.

**Description (120–150 words):**

> Handback turns a narrated screen recording of a bug into a repro-grade brief your coding agent
> can act on. You hit record in the running app and talk through what's wrong; Handback distills
> the take into a transcript, keyframes rendered to contact sheets, and the console errors that
> fired while you spoke, then writes a report.md addressed to an agent rather than a human tracker.
> Your agent pulls the brief over MCP, opens the fix, and calls `post_result` so the reviewer sees
> what changed. A human watches the before-recording against the fix and signs off — nothing merges
> without a person in the loop. The hosted server needs no install: one `claude mcp add` line and a
> token minted at handback.dev/connect. Free during alpha.

**Categories:** developer tools · productivity

**Auth:** Bearer token, per user, minted at https://handback.dev/connect. The token pins the
caller — an agent reaches its owner's personal space and every team they belong to.

**Endpoint:** `https://handback.dev/mcp` (StreamableHTTP, stateless)

**Tools (six):**

- `list_walkthroughs` — walkthroughs across your personal space and every team your token reaches, newest first; each carries its `space`. Optional `status` filter.
- `get_walkthrough` — one walkthrough's full brief: metadata, the report.md authored for agents, and presigned URLs for every file (video, keyframes, transcript).
- `set_walkthrough_status` — move a walkthrough through review: open → in_review when a fix is up, resolved after human sign-off.
- `post_result` — post what you did for the reviewer to sign off on: a summary plus optional PR url, files touched, and a longer markdown body; also flips an open walkthrough to in_review.
- `ask_reviewer` — ask the human a clarifying question instead of guessing; the walkthrough moves to needs_info, the reviewer is emailed, and their answer lands in the review thread.
- `attach_evidence` — get presigned PUT urls for up to 4 proof screenshots; upload each, then pass the returned paths as `post_result`'s evidence.

---

## Targets

### Official MCP registry (registry.modelcontextprotocol.io)

- [ ] Submitted — live URL:

`server.json` (validate against the current schema at submit time — it evolves):

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-07-09/server.schema.json",
  "name": "dev.handback/handback",
  "description": "Narrated bug recordings become briefs your coding agent pulls, fixes, and hands back to sign off.",
  "version": "1.0.0",
  "websiteUrl": "https://handback.dev",
  "remotes": [
    { "type": "streamable-http", "url": "https://handback.dev/mcp" }
  ]
}
```

The `description` here is trimmed to ≤100 chars for the registry field; the canonical one-liner
above is the full version for every other target.

Steps:
1. Install the publisher CLI (`mcp-publisher`) and log in. The `dev.handback/*` namespace needs
   domain verification for `handback.dev` — either DNS (a TXT record the CLI prints) or HTTP
   (a file served under the domain). GitHub-based namespaces (`io.github.<user>/*`) verify via
   GitHub login instead; use the domain namespace since we own handback.dev.
2. `mcp-publisher publish` against the `server.json` above.
3. Re-validate `server.json` against the schema URL current at submit time before publishing —
   the schema version in `$schema` will likely have moved past `2025-07-09`.

### mcp.so

- [ ] Submitted — live URL:

Submission is a GitHub issue/PR (or the site form). Paste-ready:

- **Name:** Handback
- **Tagline:** Turn narrated screen recordings of bugs into repro-grade briefs your coding agent pulls, fixes, and hands back for human sign-off.
- **URL:** https://handback.dev
- **Endpoint:** https://handback.dev/mcp (StreamableHTTP)
- **Categories:** developer tools, productivity
- **Description:** (canonical 120–150-word paragraph above)

### PulseMCP

- [ ] Submitted — live URL:

Submit form. Fields:

- **Name:** Handback
- **Short description / tagline:** Turn narrated screen recordings of bugs into repro-grade briefs your coding agent pulls, fixes, and hands back for human sign-off.
- **Website:** https://handback.dev
- **Server URL:** https://handback.dev/mcp
- **Auth:** Bearer token, minted at https://handback.dev/connect
- **Categories:** developer tools, productivity
- **Long description:** (canonical paragraph)

### Glama.ai MCP directory

- [ ] Submitted — live URL:

Same fields as PulseMCP:

- **Name:** Handback
- **Tagline:** Turn narrated screen recordings of bugs into repro-grade briefs your coding agent pulls, fixes, and hands back for human sign-off.
- **Website:** https://handback.dev
- **Server URL / endpoint:** https://handback.dev/mcp (StreamableHTTP)
- **Auth:** Bearer token from https://handback.dev/connect
- **Categories:** developer tools, productivity
- **Description:** (canonical paragraph)
- **Tools:** the six listed in the canonical block

### Smithery

- [ ] Submitted — live URL: *(may be blocked — see note)*

Smithery is stdio/config-centric and generally wants a public repo to build from. What we can
provide without one:

- **Hosted HTTP entry:** `https://handback.dev/mcp` (StreamableHTTP, Bearer auth)
- **`claude mcp add` line:**
  ```
  claude mcp add --transport http handback https://handback.dev/mcp --header "Authorization: Bearer hb_…"
  ```
- **Auth:** Bearer token minted at https://handback.dev/connect

**Blocker:** the repo (`dested/handback`) is private. If Smithery requires a public repo or a
Dockerfile it can build, this one is blocked until we either publish a thin public wrapper repo
(just the stdio `cli/mcp.ts` entry + a README pointing at the hosted endpoint) or Smithery accepts
a hosted-HTTP-only listing. Skip if it hard-requires a public build; note the reason in the
checkbox line.

### awesome-mcp-servers (punkpeye + wong2)

- [ ] punkpeye/awesome-mcp-servers — live URL:
- [ ] wong2/awesome-mcp-servers — live URL:

One-line PR entry (match each list's existing section format — likely under a developer-tools /
productivity heading):

```
- [Handback](https://handback.dev) - Narrated screen recordings of bugs distilled into briefs; agents pull, fix, and hand back for human sign-off.
```

- **PR title:** `Add Handback (narrated bug recordings → agent-pullable briefs)`
- **PR description:** Adds Handback, a hosted MCP server (`https://handback.dev/mcp`, StreamableHTTP) that turns narrated screen recordings of bugs into repro-grade briefs a coding agent pulls over MCP, fixes, and hands back for human sign-off. Six tools (list/get walkthroughs, set status, post_result, ask_reviewer, attach_evidence). Bearer-token auth, token minted at https://handback.dev/connect. Entry placed under <section>, alphabetized per the list's convention.

---

## When submitting

- These listings are durable SEO and discovery pointed at exactly the beachhead — worth the care.
- Keep the name and tagline **identical** across every target; trim to fit fields, never reword.
- Add the live listing URL next to each `- [ ]` once accepted, and flip the box.

# Untangle the exchange pane

- **Date:** 2026-08-24
- **Status:** done
- **Type:** plan
- **What:** the viewer's 360px "exchange" pane fused four unrelated jobs into one
  confusing column; split it so each surface has one audience.

## The problem (owner: "i hate the conversation thing on the right… whos that
for, what are the two buttons, whats the chat, bad placement")

`desk/exchange.tsx` was one 360px right column that merged:
1. the human↔agent review (results, questions, answers, send-backs) + sign-off,
2. timestamped comments,
3. the AI **assistant** that edits the walkthrough (a `comment | assistant`
   composer toggle — the "two buttons"; the "chat" = the assistant thread),
4. refine/activity system lines.

No stated audience; an AI editor sat in the same thread as the human review.

## The decisions (owner-answered)

- **Assistant** → pulled out of the review entirely, onto its own **Edit with
  AI** tab (labeled so it never reads as a person).
- **Placement** → the pane becomes a **rail tab** (Conversation); the third
  column is deleted, desk is now `[rail | work]`.
- **Name** → "the exchange" → **Conversation** (plain).
- **Forced consequence:** the sign-off card + needs_info answer form move onto
  the **Overview/Verdict hero** (`review-actions.tsx`) — otherwise the product's
  core action would be buried behind a tab. The verdict and the act-on-it live
  together now.

## What shipped

- New `desk/conversation.tsx` (`Conversation`) — thread + single comment box.
- New `desk/assistant.tsx` (`AssistantTab`) — the "Edit with AI" tab.
- New `desk/review-actions.tsx` (`SignOff`, `AnswerForm`) — on the Overview hero.
- `desk/types.ts` — DeskTab gains `conversation` + `assistant`.
- `desk/rail.tsx` — Conversation item under the hero, Edit with AI in a `revise`
  group; two new icons.
- `desk/overview-tab.tsx` — renders SignOff (verdict) + AnswerForm (needs_info);
  dropped the "answer it in the exchange →" pointer.
- `app/walkthrough.tsx` — two-column grid; renders the new tabs; child branch
  stacks SignOff/AnswerForm + Conversation.
- Deleted `desk/exchange.tsx`. `bun run typecheck` green.

---
name: source-command-harness-audit
description: Misskey の agent、skill、command ハーネスを 7 カテゴリで採点し、改善優先度を提示する。
---

# source-command-harness-audit

Read and follow the canonical [harness-audit command](../../../.claude/commands/harness-audit.md) as the command template and source of truth.

When running it from Codex, include `.agents/skills/` and `.codex/agents/` in the inventory alongside the canonical `.claude/` sources, without double-counting thin entrypoints and the content they load.

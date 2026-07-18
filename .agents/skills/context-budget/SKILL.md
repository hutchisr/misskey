---
name: context-budget
description: Codex セッションのコンテキスト消費を agents、skills、MCP、rules ごとに見える化し、肥大化と重複を検出して節約候補を提示する。
---

# context-budget

Read and follow the canonical [context-budget skill](../../../.claude/skills/context-budget/SKILL.md). Treat it as the source of truth.

When running it from Codex, inventory `.agents/skills/` entrypoints and `.codex/agents/*.toml`; count canonical `.claude/` content only when an entrypoint loads it, and do not double-count entrypoints and their canonical sources.

Do not assume any contributor has ECC or another user-level plugin installed. Detect the current Codex plugin and skill inventory from live session data when available, and omit unavailable user-level components rather than using repository-specific estimates.

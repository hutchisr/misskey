---
name: create-migration
description: Misskey の TypeORM migration を公式 CLI で生成し、SPDX、up/down 整合、disposable DB での検証、check-migrations まで安全に実施する。
---

# create-migration

Read and follow the canonical [working-on-backend skill](../../../.claude/skills/working-on-backend/SKILL.md), then apply its [creating migration task](../../../.claude/skills/working-on-backend/references/tasks/creating-migration.md). Treat those files and the references they route to as the source of truth.

Safety override: never run `migrate`, `revert`, or the migrate/revert/migrate cycle until the compiled configuration has been inspected and verified to target a disposable local or test database created for this task. If that cannot be proven, limit validation to static checks and `check-migrations`, and ask before any rollback operation.

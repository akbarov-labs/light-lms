# lms-light — instructions for Claude Code

1. **Read `HANDOFF.md` completely before doing anything.** It holds every product decision, the data model, the billing/salary rules, the stack, the build order (§14) and the acceptance checks (§15).
2. Work autonomously until every acceptance check in HANDOFF.md §15 passes. Do not ask Sardor questions; decide and log in `DECISIONS.md`.
3. Everything must run with `docker compose up --build`. No paid services, no cloud deploys.
4. Money math lives only in `src/lib/billing` and `src/lib/salary`, covered by vitest.
5. Commit often with clear messages. Keep `README.md` "Holat / Status" up to date at the end.

# Research notes — Cursor's AI code editing

An evidence ledger, kept in three separate categories so guesses never harden
into architecture:

- **D — Documented**: what Cursor's public docs state (primary source; fetched
  2026-10-17). Documentation is a description of intent and interface, not
  proof of internals.
- **H — Hypothesis**: what we suspect, and which experiment would distinguish
  it from the alternatives. None are treated as fact.
- **I — Implemented**: what Mini Cursor actually does, with the test that
  verifies it.

No Cursor binary was decompiled; the runtime experiments (Phase 1 of the plan)
have not been run yet. Record their results in `experiments/results.json`.

## D. Documented behavior

| ID | Fact | Source |
| --- | --- | --- |
| D1 | Agent = **Instructions** (system prompt + rules) + **Tools** + **Model**; Cursor tunes instructions and tools per model | `cursor.com/docs/agent/overview` |
| D2 | Documented tools: search files/folders (names, directory structure, exact keywords/patterns), read files (incl. images), edit files ("suggest edits … apply them automatically"), run shell commands, web search, fetch rules, browser control, image generation, ask questions | overview |
| D3 | "There is no limit on the number of tool calls Agent can make during a task." | overview |
| D4 | **Checkpoints**: automatic snapshots of modified files before significant changes; stored locally, separate from Git; restoring reverts files only, not the conversation | overview |
| D5 | Search: **Instant Grep**, a custom exact/regex/word-boundary engine that "runs automatically" and "outperforms ripgrep on large codebases" | `cursor.com/docs/agent/tools/search` |
| D6 | Privacy: the grep index is built and queried on-machine; Cursor "does not store embeddings of your codebase for search" — but file content opened by Agent can still be sent to the model | tools/search |
| D7 | **Explore subagent**: separate context window, faster model, many parallel searches; returns findings rather than raw file dumps | tools/search |
| D8 | Steering: a follow-up message is delivered at the agent's next tool call, preserving in-flight work | overview |

## H. Hypotheses (to be tested)

| ID | Hypothesis | Distinguishing evidence | Experiment |
| --- | --- | --- | --- |
| H1 | Retrieval is layered: name/path search + regex grep + fuzzy/semantic signals. (D5/D6 suggest exact match is one layer and embedding-indexed search is not how grep works — but other layers remain unverified.) | Which files get read, in what order; shape of the search patterns shown in tool actions | 1 |
| H2 | Cross-file coordination is model-driven in a tool loop (D3), not a precomputed dependency graph. | Order of reads; whether files outside the import graph are touched | 2 |
| H3 | With two near-identical components, the agent reads candidates and decides by content — or asks a question (D2 "ask questions"). | Whether both `UserTable.tsx` and `UserTableOld.tsx` are read; which one wins; any clarifying question | 3 |
| H4 | Under context pressure the ranking layers + Explore subagent (D7) keep recall high. | Required files in top-N reads; subagent usage in the trace | 4 |
| H5 | Pre-existing errors are only "known" if the agent runs a command that surfaces them (no documented diagnostics tool). | Whether the run mentions the error without a terminal action | 5 |
| H6 | Failed edits are revised by re-reading and issuing a new edit; rollback is checkpoint-based (D4), not transactional. | Re-read before correction; checkpoint restore behavior | 6 |

Note on our own baseline: in the fixture, a search for "users table search"
ties `UserTable.tsx` and `UserTableOld.tsx` at score 7 (see
`experiments/runs/mock-demo.jsonl`) — exactly the ambiguity Experiment 3 is
designed to probe.

## I. Verified in our implementation (Mini Cursor)

| ID | Decision | Verified by |
| --- | --- | --- |
| I1 | Guarded workspace: path/symlink containment, 100 KB read cap, `.env`/`.git` deny list, atomic temp+rename writes, no new files | `test/workspace.test.ts` |
| I2 | Lexical baseline: filename hits 5× content hits, dedup terms, top 10, 500-file cap | `test/workspace.test.ts` |
| I3 | Optional semantic retrieval (file-level embeddings, cosine) + hybrid via Reciprocal Rank Fusion `1/(60+rank)` | `test/search.test.ts` |
| I4 | Tool loop: search → read → propose; the model never writes; tool errors return `{error}` JSON for recovery | `test/agent-loop.test.ts` |
| I5 | Edits are exact-match, unique-span; same-file edits compose in order; whitespace-only mismatches get a hint | `test/proposal.test.ts` |
| I6 | Diff review before write; drift detection (content compare) before apply; best-effort multi-file rollback | `test/apply.test.ts` |
| I7 | Validation = the repository's own declared `typecheck`/`test` scripts, run after apply | `test/checks.test.ts` |
| I8 | The canonical fixture task is runnable offline end-to-end and every literal edit matches the real fixture | `test/offline-demo.test.ts` |

Deliberate deviations from Cursor's documented choices (for now):

- No checkpoints (D4) — git is the checkpoint, per the plan's advice.
- No terminal tool (D2) — validation runs the repo's scripts at the user's
  request instead.
- No Explore subagent (D7) — one context, linear loop (simpler to evaluate).

## Open questions / next evidence to gather

1. Run the six experiments (see `experiments/README.md`) and fill
   `results.json`. Until then, H1–H6 are untested.
2. Retrieval benchmark (Phase 4-A): lexical vs hybrid recall on fixture tasks.
3. Targeted patch vs whole-file rewrite error rates (Phase 4-B).
4. Does a planning phase help, and at what token cost (Phase 4-C)?
5. AST/symbol-aware retrieval and per-function chunks (plan Day 6) — the
   current per-file embeddings are the crudest possible semantic layer.

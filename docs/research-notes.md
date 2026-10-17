# Research notes — Cursor's AI code editing

An evidence ledger, kept in three separate categories so guesses never harden
into architecture:

- **D — Documented**: what Cursor's public docs state (primary source; fetched
  2026-10-17, plus archived 2025 snapshots where pages were retired).
  Documentation is a description of intent and interface, not proof of
  internals.
- **O — Observed**: what Cursor's own runtime logs and state on this machine
  recorded (Cursor 0.46.8, sessions 2025-03-02/05). Shipped behavior, but old
  and narrow. Full write-up: `docs/cursor-indexing.md`.
- **H — Hypothesis**: what we suspect, and which experiment would distinguish
  it from the alternatives. None are treated as fact.
- **I — Implemented**: what Mini Cursor actually does, with the test that
  verifies it.

No Cursor binary was decompiled, and the six runtime experiments (Phase 1 of
the plan) have not been run yet — record their results in
`experiments/results.json`. The O rows come from leftover installation logs,
not from experiments we controlled.

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
| D9 | Indexing uploads the codebase "in small chunks" to the server to compute embeddings; plaintext "ceases to exist after the life of the request"; only embeddings + metadata (hashes, obfuscated file names) are stored | archived `docs.cursor.com/account/privacy` (snapshot 2025-05-29) |
| D10 | Per-file embeddings power codebase answers; each instance auto-indexes on open and for new files; status under Settings > Features > Codebase Indexing; `.gitignore` + `.cursorignore` respected; Pro 50k / Business 250k files | archived `docs.cursor.com/context/codebase-indexing` (snapshot 2025-06-07) |
| D11 | `.cursorignore` blocks indexing + AI access; `.cursorindexingignore` excludes from the index only (still readable by AI); a default ignore list (locks, `.env*`, binaries/media/archives, `node_modules/`, `.git/`, caches) applies to indexing | archived `docs.cursor.com/context/ignore-files` (snapshot 2025-05-25) |
| D12 | The embedding-index docs were retired: `cursor.com/docs/context/codebase-indexing` now redirects to Search; Instant Grep is "built and queried on your machine" and Cursor "does not upload file paths or code to build a search index, and it does not store embeddings of your codebase for search" | `cursor.com/docs/agent/tools/search` + `/docs/llms.txt` (fetched 2026-10-17) |

## O. Observed in the shipped product

Leftover Cursor **0.46.8** logs/state on this machine (sessions 2025-03-02,
2025-03-05) record the real indexing protocol. Quoted lines and workspace
artifacts are collected in `docs/cursor-indexing.md`; this is one old version
on one machine, not proof of current internals.

| ID | Observation | Source |
| --- | --- | --- |
| O1 | Indexing runs in the bundled extension `anysphere.cursor-retrieval` ("Cursor Indexing & Retrieval" channel); per-workspace job lifecycle ("multiCodebaseIndexingJob dispose", "Aborting indexing job") | indexing logs |
| O2 | Index backend is `repo42.cursor.sh` (post-login; `api2.cursor.sh` pre-login); `cursorCreds.repoBackendUrl`/`contextBankUrl` confirm it | logs + `state.vscdb` |
| O3 | Indexing requires auth ("accessToken is undefined. User is not logged in. We shouldn't do any indexing."); repo identity from `git config --get remote.origin.url` | logs |
| O4 | Client computes a Merkle tree and one 64-hex root hash (3.6–176 ms on the tiny test repos); hash changes iff content changes | logs |
| O5 | Handshake returns `{"status":"STATUS_SUCCESS","codebases":[{"codebaseId":"<uuid>","status":"STATUS_EMPTY\|UP_TO_DATE\|OUT_OF_SYNC"}]}` | logs |
| O6 | `UP_TO_DATE` → 0 uploads; `EMPTY` → upload all embeddable files; `OUT_OF_SYNC` → subtree walk ("syncing point nextSubtree {\"relativePath\":\".\",\"hash\":…}") uploads only changed files (1 edit → 1 upload, 2 additions → 2 uploads) | logs |
| O7 | Uploads are per-file jobs with retries ("Completed job unsuccessfully, will retry"; "Completed job successfully: <codebaseId> .\\index.js"); concurrency is semaphore-bounded | logs |
| O8 | Server-pushed `indexingConfig`: `maxConcurrentUploads: 384, maxFileRetries: 20, syncConcurrency: 20, absoluteMaxNumberFiles: 100000, autoIndexingMaxNumFiles: 10000` | `state.vscdb` key `cursorai/serverConfig` |
| O9 | Per-workspace client artifacts: `anysphere.cursor-retrieval/embeddable_files.txt` (includes `.gitignore`, `package.json`, `README.md`, `*.sql`, `Dockerfile*`; excludes lock files/node_modules) and `high_level_folder_description.txt` (`{"timestamp":…,"paths":[…]}`) | files on disk |

## H. Hypotheses (to be tested)

| ID | Hypothesis | Distinguishing evidence | Experiment |
| --- | --- | --- | --- |
| H1 | Retrieval is layered: name/path search + regex grep + fuzzy/semantic signals. (D5/D6 suggest exact match is one layer and embedding-indexed search is not how grep works — but other layers remain unverified.) | Which files get read, in what order; shape of the search patterns shown in tool actions | 1 |
| H2 | Cross-file coordination is model-driven in a tool loop (D3), not a precomputed dependency graph. | Order of reads; whether files outside the import graph are touched | 2 |
| H3 | With two near-identical components, the agent reads candidates and decides by content — or asks a question (D2 "ask questions"). | Whether both `UserTable.tsx` and `UserTableOld.tsx` are read; which one wins; any clarifying question | 3 |
| H4 | Under context pressure the ranking layers + Explore subagent (D7) keep recall high. | Required files in top-N reads; subagent usage in the trace | 4 |
| H5 | Pre-existing errors are only "known" if the agent runs a command that surfaces them (no documented diagnostics tool). | Whether the run mentions the error without a terminal action | 5 |
| H6 | Failed edits are revised by re-reading and issuing a new edit; rollback is checkpoint-based (D4), not transactional. | Re-read before correction; checkpoint restore behavior | 6 |
| H7 | Chunking happens client-side (likely tree-sitter-based); server-side jobs embed the uploaded content. The 0.46.8 logs show file-level units only, so this stays untested. | Upload payload contains chunk boundaries; the `cursor-retrieval` bundle contains a chunker / tree-sitter WASM | artifact inspection (needs a current Cursor install) |
| H8 | The 2026 stack is split: Instant Grep (local) serves search, while any remaining semantic/@codebase layer may still use the remote embedding index — the current docs do not say. | `repo42.cursor.sh` traffic or `repo42` strings in a current build | current-version inspection |

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
6. Verify the 2026 indexing architecture directly: install a current Cursor,
   watch the "Cursor Indexing & Retrieval" channel, inspect the
   `anysphere.cursor-retrieval` extension bundle for chunking code (REA
   `analyze-javascript-application`), and capture whether `repo42.cursor.sh`
   still receives uploads. See H7/H8.

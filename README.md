# Mini Cursor

A small, working AI code-editing agent built as a **reverse-engineering
project**, not a wrapper: we collect evidence about how Cursor behaves and
what it documents, form hypotheses, and then build and test our own
implementation against those hypotheses.

- Evidence ledger: [`docs/research-notes.md`](docs/research-notes.md)
- Experiment protocol (six Cursor experiments + retrieval benchmark):
  [`experiments/README.md`](experiments/README.md)
- Target fixture: [`fixtures/sample-react-app`](fixtures/sample-react-app)

## What works today (verified)

1. **Repository awareness** — guarded file discovery and reads: path and
   symlink containment, 100 KB read cap, `.env`/`.git` deny list, atomic
   temp+rename writes, no file creation.
2. **Context retrieval** — lexical baseline (filename matches weigh 5× over
   content matches, top 10) plus optional embedding search and a hybrid mode
   that fuses rankings with Reciprocal Rank Fusion (`1/(60+rank)`).
3. **Tool-using agent loop** — OpenAI Responses API function calling with
   three tools: `search_code`, `read_file`, `propose_edit`. The model can
   never write files; it can only stage proposals.
4. **Targeted editing** — exact-text, unique-span replacements; several edits
   to one file compose in order; ambiguous or missing matches are rejected
   with actionable errors.
5. **Diff review + approval** — every staged file gets a unified diff, then a
   yes/no gate. Drift detection re-checks file contents before writing;
   failed multi-file applies roll back already-written files.
6. **Validation** — after applying, runs the repository's own declared
   `typecheck`/`test` scripts (or custom `--validate-cmd` commands).

Plus, for research: an **offline demo mode** (no API key needed) and **JSONL
event logs** with timestamps, search hits, token usage — the raw material for
the experiments.

## Quickstart

```bash
npm install
# optional for live runs: copy .env.example to .env and fill in OPENAI_API_KEY

# 1) Offline demo (no key): canonical task, diffs only, nothing written
npm run demo

# 2) Same demo, applied to the fixture and validated, then reset
npm run dev -- fixtures/sample-react-app --mock --yes --validate
git restore fixtures

# 3) Live run against any repo
npm run dev -- <repo> "Add a search input to the users table, debounce it by 300ms, and update the API request."

# 4) Hybrid retrieval (embeddings + RRF; needs a key)
npm run dev -- <repo> "<task>" --retrieval hybrid

# Checks
npm test
npm run typecheck
```

Any OpenAI-compatible endpoint works: set `OPENAI_BASE_URL` and
`OPENAI_MODEL` in `.env` (default model: `gpt-5.4`).

### CLI reference

| Flag | Meaning |
| --- | --- |
| `--model <id>` | Model id (default: `$OPENAI_MODEL` or `gpt-5.4`) |
| `--retrieval lexical\|hybrid` | Retrieval strategy for `search_code` (default `lexical`) |
| `--max-steps <n>` | Tool-loop step limit (default 15) |
| `--mock` | Offline demo: replay a canned plan for the bundled fixture |
| `--dry-run` | Show diffs, never write |
| `--yes` / `-y` | Apply without the interactive prompt (explicit pre-approval) |
| `--validate` | Run the repo's `typecheck`/`test` scripts after applying |
| `--validate-cmd <cmd>` | Custom post-apply command (repeatable) |
| `--log <file>` | Write agent events as JSONL (timestamps, hits, usage) |

## How it works

```
src/
├── cli.ts                   args, event rendering, diff review, approval, apply, validation
├── agent/
│   ├── loop.ts              the tool loop: model turn -> tools -> results -> repeat
│   ├── model.ts             ModelClient: OpenAI Responses adapter + scripted test double
│   ├── tools.ts             search_code / read_file / propose_edit (errors -> {error} JSON)
│   ├── prompts.ts           system instructions
│   ├── events.ts            the event model the future SSE UI will stream
│   └── offline.ts           deterministic replay of the canonical fixture task
├── context/
│   ├── workspace.ts         guarded list/read/search/write (the safety boundary)
│   ├── search.ts            lexical baseline, cosine similarity, RRF, hybrid strategy
│   └── embedder.ts          OpenAI embeddings adapter
├── editing/
│   ├── proposal.ts          staged edits; unique exact-match invariant
│   ├── diff.ts              unified patches + added/removed stats
│   └── apply.ts             drift detection, atomic writes, best-effort rollback
└── validation/checks.ts     discover and run the repo's own checks
```

A run looks like: `search_code` → `read_file` (only files the model chooses)
→ `propose_edit` (staged, validated, never written) → diffs printed →
`yes/no` → writes with drift detection → optional validation. Every step emits
an event; the CLI renders it today, a React UI can stream the same events over
SSE tomorrow (plan Phase 5).

## Safety model

- The agent process can only touch files under the given repo root; path and
  symlink escapes are rejected (and tested).
- The model cannot write: `propose_edit` stages, a human (or explicit `--yes`)
  approves. "Unsafe writes: 0" is enforced by construction, not by policy.
- Writes are atomic (temp + rename) and refuse new files, symlinks, and
  non-regular files.
- Multi-file applies check every file for drift first; on a mid-apply failure
  the already-written files are restored (best effort — use git as the real
  checkpoint, exactly as the plan recommends).
- Validation commands are user-approved strings run through the platform
  shell in the repo root; treat `--validate-cmd` like running the command
  yourself.

## Verification (2026-10-17)

- `npm run typecheck` — clean (TypeScript 7.0.2, openai 7.36.0, vitest 5.0.5).
- `npm test` — 39 tests: 38 pass, 1 skipped on Windows (symlink test needs
  elevation; it runs on CI/other platforms).
- End-to-end offline demo applied 3 files to the fixture, then validation
  passed on the modified fixture (`tsc --noEmit`, `vitest run`), then the
  fixture was restored with git. See `test/offline-demo.test.ts` for the
  automated version of this against a fixture copy.
- The **live OpenAI path is typechecked, not executed here** (no API key in
  this environment). Treat it as unverified until your first live run.

## Known limits

- One edit tool (`propose_edit`): no new files, no deletes, no moves; edits
  must be exact text. Mistakes surface as tool errors the model can react to.
- Retrieval embeddings are per-file (first 4000 chars), not per-function;
  no AST/symbols, no import graph yet. That is Day 6 of the plan.
- No terminal tool, planning phase, or self-verification loop yet.
- Linear conversation memory; no token budgeting beyond size caps.
- `npm audit` reports a high-severity `braces` DoS advisory (transitive via
  `fast-glob`, no fix available). Not exploitable through this CLI: user
  queries never become glob patterns — only constant patterns are compiled.

## Roadmap status vs the 10-day plan

| Day | Plan item | Status |
| --- | --- | --- |
| 1 | Fixture repo + six Cursor experiments | Fixture done; experiments scaffolded, **not yet run** (needs Cursor + a human) |
| 2 | Workspace traversal, safe reads, lexical search | Done (tested) |
| 3 | Tool-calling loop + event logging | Done (tested); JSONL logs |
| 4 | Proposals, diffs, approval, rollback | Done (tested) |
| 5 | Ten fixture tasks + baseline metrics | Fixture tests pass; task suite not built |
| 6 | tree-sitter symbols + import graph | Not started |
| 7 | Embeddings + hybrid + retrieval benchmark | Hybrid implemented (RRF tested); benchmark harness pending |
| 8 | Validation + repair attempts | Validation done; repair loop not started |
| 9 | React UI + Monaco + SSE | Not started; event model is UI-ready |
| 10 | Evaluation vs Cursor | Not started |

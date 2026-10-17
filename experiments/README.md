# Experiments — Phase 1 protocol

Goal: distinguish *how Cursor finds and edits code* using observable evidence,
and record it in three separate columns so observations never silently become
architecture claims:

- **Observed** — what actually happened in the tool (actions, files read and
  changed, timing, validation results).
- **Hypothesis** — what the observation suggests about internals
  (cross-reference the `H*` hypotheses in `../docs/research-notes.md`).
- **Verified in our implementation** — what Mini Cursor adopts as a result,
  with a test; may be "none yet".

## Lab setup

- Fixture: `fixtures/sample-react-app` (22 files; includes misleading
  candidates `UserTableOld.tsx`, `CustomerList.tsx`, noise files
  `useLocalStorage.ts`, `auth.ts`).
- Checkpoint before every experiment (repo root):
  `git add -A && git commit -m "checkpoint"`, reset with `git restore .`.
- Use the **same prompt** for the Cursor run and the Mini Cursor run of each
  experiment.

## The six experiments

| # | Prompt (run in both tools) | What you are investigating |
| --- | --- | --- |
| 1 | "Find the function responsible for fetching users. Explain the path from the UI to the API." | Filename search vs semantic understanding |
| 2 | "Add a search input to the users table, debounce it by 300ms, and update the API request." | How dependencies are discovered; edit coordination |
| 3 | "Add the same filter to both tables" (UserTable.tsx and UserTableOld.tsx exist) | How competing candidates are resolved |
| 4 | "Add an empty-state message and a 300ms debounce." (after adding ~100 irrelevant files) | Retrieval accuracy under context pressure |
| 5 | Introduce a TypeScript error, then: "Add pagination to the users table." | Are pre-existing errors distinguished from new ones? |
| 6 | Ask for an edit; after it applies, say "that broke the layout — revert the table change." | Revision and rollback behavior |

## Recording a Cursor run

Cursor is used manually; record by hand in `results.json` (schema below).
Relevant UI surfaces: the file list the agent reads, the tool actions shown,
the diffs, and whether it asks questions.

## Recording a Mini Cursor run

```bash
# Safe inspection (nothing written), with a JSONL event log:
npm run dev -- fixtures/sample-react-app "PROMPT" --dry-run --log experiments/runs/exp1-mini-cursor.jsonl

# Applied + validated:
npm run dev -- fixtures/sample-react-app "PROMPT" --yes --validate --log experiments/runs/exp1-mini-cursor.jsonl
git restore fixtures
```

The log contains timestamps (derive `timeToFirstToolCallMs`), search hits with
scores, read byte counts, staged edits, and token usage on live runs.

## results.json schema

Each run is one object in `runs`:

| Field | Type | Notes |
| --- | --- | --- |
| `experiment` | string | `"1-file-discovery"` … `"6-failed-edit"` |
| `tool` | string | `"cursor"` or `"mini-cursor"` |
| `model` | string/null | Model id where known |
| `prompt` | string | Exact prompt used |
| `startedAt` | ISO string | |
| `timeToFirstToolCallMs` | number/null | |
| `filesInspected` | string[] | |
| `toolActions` | string[] | e.g. `"search: users table"`, `"read: src/..."` |
| `filesChanged` | string[] | |
| `unrelatedFilesTouched` | string[] | Should be `[]` |
| `validationPassed` | boolean/null | typecheck + tests after apply |
| `ambiguityHandling` | string | How competing candidates were resolved |
| `observed` / `hypothesis` / `verified` | string | The three evidence categories |

## Retrieval benchmark (Phase 4, Experiment A)

Run the same task with `--retrieval lexical` and `--retrieval hybrid`
(hybrid needs `OPENAI_API_KEY`; the offline demo always uses lexical). Score:

- **Relevant file recall** — required files present in the top 10 hits
  (the JSONL `searching` events include scores).
- **Unrelated edits** — files changed that the task did not require.
- **Edit efficiency** — necessary changed lines / total changed lines.

Record one `retrieval` object per task:

```json
{
  "task": "...",
  "requiredFiles": ["src/..."],
  "lexicalRecall10": 0.0,
  "hybridRecall10": 0.0,
  "unrelatedEdits": 0
}
```

These are measurement procedures, not results. Targets from the plan (≥70%
task success, ≥90% recall@10, 0 unrelated edits, 0 unsafe writes) are goals,
not measured values yet.

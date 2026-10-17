# Code tour — read the code in this order

Everything in `docs/` and `experiments/` is research apparatus. This tour is
about the software itself. Every source file starts with a comment saying
where it fits, so you can also just open files at random.

1. **`src/context/workspace.ts`** — the file-system boundary. Everything the
   agent reads or writes goes through this one class; path escapes, symlinks,
   oversized files, `.env` files and new-file creation are all rejected here.
2. **`src/editing/proposal.ts`** — staged edits. The model *proposes*
   exact-text replacements; this class validates them (exactly one match,
   edits compose per file) and keeps the original content for drift checks.
3. **`src/editing/apply.ts`** + **`diff.ts`** — the write gate. Diffs are
   rendered from staged edits; nothing is written until every file has been
   re-checked against its staged content. A failed multi-file apply rolls
   back what was already written.
4. **`src/agent/tools.ts`** — the three tools (`search_code`, `read_file`,
   `propose_edit`) and their promise: tool errors become JSON the model can
   react to.
5. **`src/agent/model.ts`** — the only file that talks to a provider. It
   defines the tiny neutral language (`ConversationItem`, `ToolDef`,
   `ModelTurn`) and two implementations: live OpenAI and the scripted test
   double used by the offline demo.
6. **`src/agent/loop.ts`** — the agent loop. Four numbered steps per turn,
   written out as comments: ask → record → stop if no tools → run tools.
7. **`src/validation/checks.ts`** — runs the repository's *own* declared
   `typecheck`/`test` scripts after edits are applied.
8. **`src/cli.ts`** — wiring only: parse args → run → review → approve →
   apply → validate. Each phase is its own small function.

Then:

- `test/` mirrors this exact list; each file's header says what it proves.
- `src/agent/offline.ts` is the canned plan the offline demo replays.
- `fixtures/sample-react-app` is the target repo the demo edits.

## The whole flow, one picture

```
 cli.ts                task + flags
   │
   ▼
 agent/loop.ts ──────► model.complete()          agent/model.ts
   │                        │ tool calls
   │        ◄───────────────┘
   │  executeTool()                                agent/tools.ts
   │    search_code  → context/search.ts           (lexical or hybrid)
   │    read_file    → context/workspace.ts
   │    propose_edit → editing/proposal.ts         (staged only — no disk writes)
   ▼
 staged edits → unified diffs                     editing/diff.ts
   │
   ▼ "Apply all changes? (yes/no)"
 editing/apply.ts   drift check → atomic writes → rollback on failure
   │
   ▼ optional
 validation/checks.ts   npm run typecheck / npm test (declared by the repo)
```

## Three invariants that keep it honest

1. **The model never writes.** `propose_edit` stages; only the CLI's apply
   phase writes.
2. **Writes need approval and a drift check.** Explicit yes (or `--yes`), and
   every file must still match the content the diff was generated from.
3. **Validation is declared, never invented.** Only the repo's own scripts or
   explicit `--validate-cmd` flags run.

## Where to change what

| I want to change… | Touch this |
| --- | --- |
| Add or change a tool | `src/agent/tools.ts` (plus a line in `prompts.ts`) |
| Retrieval strategy | `src/context/search.ts` |
| How edits match/validate | `src/editing/proposal.ts` |
| Apply/rollback semantics | `src/editing/apply.ts` |
| Provider or model API | `src/agent/model.ts` |
| A CLI flag | `parseArgs` + `printUsage` in `src/cli.ts` |
| The fixture or demo plan | `fixtures/sample-react-app` + `src/agent/offline.ts` (then run `npm test` — the e2e test catches literal mismatches) |

## Deliberately simple choices (each pinned by a test, so you can swap them)

- Lexical search is the default; embeddings are opt-in.
- Edits are whole-file staged exact-text replacements, not AST patches.
- The loop is linear; there is no planning phase or repair attempt yet.

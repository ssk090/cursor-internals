# How Cursor indexes a codebase — evidence-based

This is the deep-dive the project needed: an answer built from **three evidence
types kept separate**, per the rules in `research-notes.md`:

- **[O] Observed** — real runtime logs and state files from **Cursor 0.46.8**
  found on this machine (user install, sessions 2025-03-02 and 2025-03-05,
  preserved under `%APPDATA%\Cursor`). This is the shipped product talking,
  but it is one old version on one machine.
- **[D] Documented** — Cursor's own docs, including archived snapshots of
  pages that no longer exist (`web.archive.org`). Docs describe intent and
  interface, not proof of internals.
- **[H] Hypothesis** — our best explanation where evidence runs out, each with
  the experiment that would test it.

One-line summary: **Cursor 0.46.8 kept a Merkle tree of your workspace on the
client, handshook its root hash with a remote `repo42.cursor.sh` index
service, uploaded only changed files, and the service stored embeddings plus
"hashes, obfuscated file names" — never plaintext code.** The 2026 docs
describe a different, local-first search stack (Instant Grep) and no longer
publish the embedding-index design.

---

## 1. The pipeline, stage by stage

Each stage lists what was actually seen and where it is grounded.

### Stage 1 — Auth and repo identity [O]

From the `Cursor Indexing & Retrieval` output channel of the extension
`anysphere.cursor-retrieval`:

```
[error] accessToken is undefined. User is not logged in. We shouldn't do any indexing.
[info]  Creating repo client with backend url: https://repo42.cursor.sh
[error] Git command failed: git config --get remote.origin.url
```

- Indexing is **skipped entirely when logged out**; it is tied to an account.
- Repo identity starts from the git remote (`git config --get
  remote.origin.url`); non-git folders logged an error but still indexed.
- The index backend is separate from the main API: before login the client
  pointed at `api2.cursor.sh`, after login at `repo42.cursor.sh`. The state
  database (`state.vscdb` key `cursorai/serverConfig`) confirms
  `repoBackendUrl` and `contextBankUrl` are both `https://repo42.cursor.sh`.

### Stage 2 — Merkle tree + handshake [O]

```
[info] Finished computing merkle tree in 57.1 ms.
[info] Doing the initial handshake with hash: 862d19d84262535633fd34e8b94a107d1d384eeba1b170b2a3c9ac35530c71d2
[info] Handshake timing: 924.9, response: {"status":"STATUS_SUCCESS",
       "codebases":[{"codebaseId":"77dc43a9-…","status":"STATUS_EMPTY"}]}
```

- The **client** builds a Merkle tree over the workspace and derives one
  64-hex root hash (3.6–176 ms on these tiny repos).
- The hash is a pure content fingerprint: editing one file changed it
  (`862d…` → `1d22…`), adding files changed it again (`→ 0780…`), and an
  unchanged repo produced the identical hash across restarts.
- The handshake is a single request/response (233–953 ms round trip) that
  syncs client and server state per codebase. The server answers with a
  per-codebase status:

| Status | Meaning | Client reaction [O] |
| --- | --- | --- |
| `STATUS_EMPTY` | Server has no copy | "Starting repository upload from scratch." — upload all embeddable files |
| `STATUS_UP_TO_DATE` | Root hashes match | No uploads; "Finished indexing repository." immediately |
| `STATUS_OUT_OF_SYNC` | Hashes differ | "Starting fast remote sync." — walk the tree, upload the delta |

The `codebaseId` (a UUID) is minted on first sync and reused afterwards; it
identifies *this workspace for this account* on the service.

### Stage 3 — Delta sync [O]

For `OUT_OF_SYNC`, the client walks the Merkle tree from the root:

```
[info] [startSync]: ----------------------
syncing point nextSubtree{"relativePath":".","hash":"1d2260ff…"}
[info] setting numJobsToGo to 2
[info] [startSync]: numJobs: 2
[info] Uploading 2 files.
```

Subtree hashes that match the server's copy are skipped; only mismatched
subtrees descend to file level. The observed deltas were exact:

| Workspace change | Embeddable files | Files uploaded |
| --- | --- | --- |
| First index | 3 | 3 ("from scratch") |
| One file edited | 3 | 1 |
| Two files added | 5 | 2 |
| Nothing changed | 3 | 0 |

This is the payoff of the Merkle design: **upload cost scales with your
edit, not with repository size**. It also means the server never needs to
diff your files — tree hashes do it.

### Stage 4 — Per-file jobs and embedding [O]

Each upload is tracked as a job per file:

```
[info] Completed job unsuccessfully, will retry: .\index.js error: Bad unexpected error
[info] Completed job successfully: 77dc43a9-… .\index.js
```

- Failures are retried (server-pushed `maxFileRetries: 20`).
- Jobs are concurrency-bounded (semaphore log lines;
  `maxConcurrentUploads: 384`, `syncConcurrency: 20` from
  `cursorai/serverConfig`).
- The client logs file-level units. **Where file → chunk slicing and the
  embedding model actually run is not decidable from these logs** — see
  H1 below.

### Stage 5 — What gets indexed [O]+[D]

The client keeps its own candidate list per workspace:
`workspaceStorage/<id>/anysphere.cursor-retrieval/embeddable_files.txt`.
Observed examples:

```
package.json            routes\userRoutes.js        packages\db\prisma\schema.prisma
index.js                .gitignore                  apps\docker\Dockerfile.backend
db.js                   middleware\auth.js          apps\backend\README.md
```

Mixed text formats are in (`.sql`, `.prisma`, `Dockerfile*`, `README.md`),
while lock files, `node_modules/`, binaries and media are out — matching the
documented **default ignore list** [D]:

> For indexing only … `package-lock.json`, `pnpm-lock.yaml`, `.env*`,
> `.git/`, `*.lock`, `*.bin`, `*.exe`, `*.png`, `*.mp4`, `*.zip`,
> `node_modules/`, `__pycache__/`, `.next/`, …

The other client artifact is a tiny cache, not an LLM summary:

```
high_level_folder_description.txt:
{"timestamp":1740592983561,"paths":[".\\db.js",".\\index.js",".\\package.json"]}
```

Three ignore mechanisms are documented [D]:

- `.gitignore` — always respected (VS Code's ignore package).
- `.cursorignore` — blocks **indexing and AI access** ("best effort").
- `.cursorindexingignore` — removes files from the **index only**; the agent
  can still read them when it searches at runtime.

### Stage 6 — Privacy: what leaves your machine [D]

From the 2025 privacy FAQ (archived during the same era as the logs):

> If you choose to index your codebase, Cursor will upload your codebase in
> small chunks to our server to compute embeddings, but all plaintext code
> ceases to exist after the life of the request. The embeddings and metadata
> about your codebase (hashes, obfuscated file names) are stored in our
> database, but none of your code.

So the design *documented* at that time: chunk → upload → embed → **drop
plaintext** → store vectors + hashes + obfuscated names.

---

## 2. What the 2026 docs say (and what they don't) [D]

The page this document is named after no longer exists. Today:

- `cursor.com/docs/context/codebase-indexing` redirects into the agent
  **Search** docs.
- Those docs describe **Instant Grep** — "a custom search engine that
  outperforms ripgrep", built and queried **on your machine** — and state:
  "Cursor does not upload file paths or code to build a search index, and it
  does not store embeddings of your codebase for search."
- `/docs/llms.txt` (the docs sitemap) contains no indexing page at all.

That is a striking evolution from the 2025 architecture in Sections 1. But
read the quote carefully: it is a statement about the **search index**. The
docs of 2026 are silent on whether any *semantic* retrieval layer still
uploads content — silence, not absence. See H2.

---

## 3. Hypotheses and how to test them

**H1 — Chunking happens client-side (likely tree-sitter-based); the server
embeds chunks.**
The privacy FAQ says "small chunks"; the logs show file-level *upload* units
and file-level *jobs*. Neither settles where slicing happens.
*Test:* inspect the current `anysphere.cursor-retrieval` extension bundle for
a chunker/tree-sitter WASM (REA `analyze-javascript-application` on an
extracted install); or capture the upload request body and look for chunk
boundaries. **Not tested here — Cursor is not installed on this machine.**

**H2 — 2026 has a split stack: local Instant Grep for search; any remaining
semantic/@codebase layer may still use the repo42 embedding index, or may
have been replaced.**
*Test:* run a current Cursor against a scratch repo and watch for
`repo42.cursor.sh` traffic (`Cursor Indexing & Retrieval` logs, or a
temporary HTTP proxy); grep the current bundle for `repo42`.

**H3 — The stored "obfuscated file names" are what retrieval keys matching
chunks back to your workspace, while content mapping stays client-side.**
*Test:* compare a chunk hit's path handling in a current build's logs; this
was never visible in the 0.46.8 logs.

---

## 4. How this maps onto Mini Cursor

| Cursor (observed/documented) | Mini Cursor (implemented) |
| --- | --- |
| Merkle tree + hashes detect what changed | Not implemented — we re-run retrieval per task; the fixture is tiny |
| Remote embedding index (`repo42`) | Optional local embeddings (`src/context/embedder.ts`) + RRF hybrid search (`I3`) |
| Instant Grep (local exact/regex search) | `search_code` lexical baseline, filename 5× content weight (`I1`, `I2`) |
| `.gitignore` + `.cursorignore` + default list | Hard-coded ignore globs in `workspace.ts`; deny-list for `.env*`/`.git` |
| Uploads chunks, drops plaintext, stores vectors | Nothing leaves the machine; `ModelClient` is the only network boundary |

The interesting lesson for our roadmap is the **delta principle**: Cursor
never re-sends unchanged content, because a Merkle tree reduces "what
changed?" to a hash comparison. If we ever index bigger repos, that is the
first idea to copy (and `offline.ts` + `workspace.ts` already give us the
list/hash primitives to do it).

---

## 5. Sources

**Observed (this machine, Cursor 0.46.8)**
- `%APPDATA%\Cursor\logs\20250302T215927\window1\exthost\anysphere.cursor-retrieval\Cursor Indexing & Retrieval.log`
- `%APPDATA%\Cursor\logs\20250305T000638\window1\exthost\anysphere.cursor-retrieval\Cursor Indexing & Retrieval.log`
- `%APPDATA%\Cursor\User\globalStorage\state.vscdb` (keys `cursorai/serverConfig`, `src.vs.platform…persistentStorage.applicationUser`)
- `%APPDATA%\Cursor\User\workspaceStorage\*\anysphere.cursor-retrieval\{embeddable_files.txt, high_level_folder_description.txt}`
- Version from `main.log`: update URL contains `/cursor/0.46.8/`

**Documented**
- Archived: `web.archive.org/web/20250607133022/https://docs.cursor.com/context/codebase-indexing`
- Archived: `web.archive.org/web/20250529124628/https://docs.cursor.com/account/privacy`
- Archived: `web.archive.org/web/20250525001140/https://docs.cursor.com/context/ignore-files`
- Current: `cursor.com/docs/agent/tools/search` + `cursor.com/docs/llms.txt` (fetched 2026-10-17)

**Limitations, stated plainly**
- One old app version (0.46.8, March 2025), two tiny workspaces (3–5 files),
  one account. No payload captures, no binary decompilation.
- Archived docs record what was documented then, not what shipped later.
- `STATUS_*` names and `indexingConfig` values are read from logs/state and
  quoted verbatim; their server-side semantics beyond what is shown here are
  unknown.

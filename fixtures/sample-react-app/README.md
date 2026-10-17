# sample-react-app (fixture)

A tiny React + TypeScript app used as the target repository for mini-cursor
experiments. It deliberately includes misleading candidates and reusable
utilities:

- `src/components/UserTable.tsx` — the real users table (calls `useUsers`)
- `src/components/UserTableOld.tsx` — legacy table with an inline,
  un-debounced filter (misleading candidate for search)
- `src/hooks/useUsers.ts` — the data hook
- `src/hooks/useDebounce.ts` — an existing debounce utility to reuse
- `src/api/users.ts` — the users API client
- `src/api/auth.ts` — session/token refresh (noise for most tasks)

Validation for this fixture: `npm run typecheck` and `npm test`.

Checkpoint before experiments: `git add -A && git commit -m "checkpoint"` from
the repository root, then `git restore .` to reset between runs.

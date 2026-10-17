import { ScriptedModelClient, type ScriptedToolCall } from "./model.js";

/**
 * Offline demo mode (`--mock`).
 *
 * This replays a fixed, hand-written plan against the bundled fixture
 * (fixtures/sample-react-app) so the whole pipeline — search, read, stage,
 * diff, approve, apply, validate — is runnable with no API key. It is a test
 * double, not a model: it does not generalize to other tasks or repositories.
 */

export const FIXTURE_DEMO_TASK =
  "Add a search input to the users table, debounce it by 300ms, and update the API request.";

const USER_TABLE = "src/components/UserTable.tsx";
const USE_USERS = "src/hooks/useUsers.ts";
const USERS_API = "src/api/users.ts";

type LiteralEdit = { file: string; oldText: string; newText: string };

const userTableEdits: LiteralEdit[] = [
  {
    file: USER_TABLE,
    oldText: [
      'import { useUsers } from "../hooks/useUsers";',
      'import { Spinner } from "./Spinner";',
      'import { ErrorBanner } from "./ErrorBanner";',
      'import { formatUserName } from "../utils/format";',
      "",
      "export function UserTable() {",
      "  const { users, loading, error, reload } = useUsers();",
    ].join("\n"),
    newText: [
      'import { useState } from "react";',
      'import { useDebounce } from "../hooks/useDebounce";',
      'import { useUsers } from "../hooks/useUsers";',
      'import { SearchInput } from "./SearchInput";',
      'import { Spinner } from "./Spinner";',
      'import { ErrorBanner } from "./ErrorBanner";',
      'import { formatUserName } from "../utils/format";',
      "",
      "export function UserTable() {",
      '  const [search, setSearch] = useState("");',
      "  const debouncedSearch = useDebounce(search, 300);",
      "  const { users, loading, error, reload } = useUsers(debouncedSearch);",
    ].join("\n"),
  },
  {
    file: USER_TABLE,
    oldText: ["  return (", '    <table className="user-table">'].join("\n"),
    newText: [
      "  return (",
      '    <table className="user-table">',
      "      <caption>",
      "        <SearchInput",
      "          value={search}",
      "          onChange={setSearch}",
      '          placeholder="Search users..."',
      "        />",
      "      </caption>",
    ].join("\n"),
  },
];

const useUsersEdits: LiteralEdit[] = [
  {
    file: USE_USERS,
    oldText: "export function useUsers(): UsersState {",
    newText: 'export function useUsers(search = ""): UsersState {',
  },
  {
    file: USE_USERS,
    oldText: ["    fetchUsers()", "      .then((result) => {"].join("\n"),
    newText: ["    fetchUsers(search)", "      .then((result) => {"].join("\n"),
  },
  {
    file: USE_USERS,
    oldText: "  }, [reloadToken]);",
    newText: "  }, [search, reloadToken]);",
  },
];

const usersApiEdits: LiteralEdit[] = [
  {
    file: USERS_API,
    oldText: [
      "export function buildUsersUrl(): string {",
      '  return "/api/users";',
      "}",
    ].join("\n"),
    newText: [
      "export function buildUsersUrl(search?: string): string {",
      "  const params = new URLSearchParams();",
      '  if (search) params.set("search", search);',
      "  const query = params.toString();",
      '  return query ? `/api/users?${query}` : "/api/users";',
      "}",
    ].join("\n"),
  },
  {
    file: USERS_API,
    oldText: [
      "export async function fetchUsers(): Promise<User[]> {",
      "  return apiGet<User[]>(buildUsersUrl());",
      "}",
    ].join("\n"),
    newText: [
      'export async function fetchUsers(search = ""): Promise<User[]> {',
      "  return apiGet<User[]>(buildUsersUrl(search));",
      "}",
    ].join("\n"),
  },
];

const allEdits: LiteralEdit[] = [...userTableEdits, ...useUsersEdits, ...usersApiEdits];

const proposeCalls: ScriptedToolCall[] = allEdits.map((edit) => ({
  name: "propose_edit",
  arguments: { file: edit.file, oldText: edit.oldText, newText: edit.newText },
}));

export function createFixtureDemoClient(): ScriptedModelClient {
  return new ScriptedModelClient(
    [
      () => [{ name: "search_code", arguments: { query: "users table search" } }],
      () => [
        { name: "read_file", arguments: { file: USER_TABLE } },
        { name: "read_file", arguments: { file: USE_USERS } },
        { name: "read_file", arguments: { file: USERS_API } },
        { name: "read_file", arguments: { file: "src/components/SearchInput.tsx" } },
        { name: "read_file", arguments: { file: "src/hooks/useDebounce.ts" } },
      ],
      () => proposeCalls,
    ],
    "Staged 3 files: UserTable.tsx (reuses SearchInput, debounces 300ms), useUsers.ts (search parameter, refetch on change), users.ts (search query param).",
  );
}

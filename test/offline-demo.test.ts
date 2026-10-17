import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgent } from "../src/agent/loop.js";
import { createFixtureDemoClient } from "../src/agent/offline.js";
import { Workspace } from "../src/context/workspace.js";
import { applyEdits } from "../src/editing/apply.js";
import { makeTempDir, type TempDir } from "./helpers.js";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "sample-react-app",
);

/**
 * End-to-end check of the offline demo plan against a copy of the bundled
 * fixture: every literal edit must match the real fixture files, and applying
 * must produce the intended feature.
 */
describe("offline demo plan (end to end)", () => {
  let temp: TempDir;
  let appDir: string;

  beforeAll(async () => {
    temp = await makeTempDir("mini-cursor-e2e-");
    appDir = path.join(temp.dir, "app");
    await fs.cp(FIXTURE, appDir, {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}node_modules`),
    });
  });

  afterAll(async () => {
    await temp.cleanup();
  });

  it("stages and applies the canonical task", async () => {
    const workspace = new Workspace(appDir);
    const edits = await runAgent(workspace, "demo", {
      model: createFixtureDemoClient(),
    });

    expect(edits.map((edit) => edit.file).sort()).toEqual([
      "src/api/users.ts",
      "src/components/UserTable.tsx",
      "src/hooks/useUsers.ts",
    ]);

    await applyEdits(workspace, edits);

    const table = await fs.readFile(
      path.join(appDir, "src/components/UserTable.tsx"),
      "utf8",
    );
    expect(table).toContain("useDebounce(search, 300)");
    expect(table).toContain("useUsers(debouncedSearch)");
    expect(table).toContain('placeholder="Search users..."');

    const hook = await fs.readFile(
      path.join(appDir, "src/hooks/useUsers.ts"),
      "utf8",
    );
    expect(hook).toContain('export function useUsers(search = "")');
    expect(hook).toContain("fetchUsers(search)");
    expect(hook).toContain("[search, reloadToken]");

    const api = await fs.readFile(path.join(appDir, "src/api/users.ts"), "utf8");
    expect(api).toContain('params.set("search", search)');
    expect(api).toContain("apiGet<User[]>(buildUsersUrl(search))");
  });
});

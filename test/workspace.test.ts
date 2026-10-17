import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace, WorkspaceError } from "../src/context/workspace.js";
import { makeTempDir, writeFiles, type TempDir } from "./helpers.js";

describe("Workspace", () => {
  let temp: TempDir;
  let workspace: Workspace;

  beforeEach(async () => {
    temp = await makeTempDir();
    await writeFiles(temp.dir, {
      "src/a.ts": "export const users = ['alice'];\n",
      "src/UserTable.tsx": "export function UserTable() {\n  return null;\n}\n",
      ".env": "SECRET=1\n",
      "notes.txt": "not code\n",
    });
    workspace = new Workspace(temp.dir);
  });

  afterEach(async () => {
    await temp.cleanup();
  });

  it("lists only code files", async () => {
    const files = await workspace.listFiles();
    expect(files).toContain("src/a.ts");
    expect(files).toContain("src/UserTable.tsx");
    expect(files).not.toContain("notes.txt");
  });

  it("denies .env reads", async () => {
    await expect(workspace.readFile(".env")).rejects.toThrow(WorkspaceError);
  });

  it("refuses relative paths that escape the workspace", async () => {
    await expect(workspace.readFile("../outside.txt")).rejects.toThrow(
      /escapes the workspace/,
    );
  });

  it("refuses absolute paths outside the workspace", async () => {
    const outside = path.resolve(temp.dir, "..", "outside.txt");
    await expect(workspace.readFile(outside)).rejects.toThrow(WorkspaceError);
  });

  it("refuses oversized files", async () => {
    await writeFiles(temp.dir, { "src/big.ts": "x".repeat(100_001) });
    await expect(workspace.readFile("src/big.ts")).rejects.toThrow(/too large/);
  });

  it("refuses symlinks that escape the workspace", async (ctx) => {
    const outsideDir = await makeTempDir();
    try {
      await writeFiles(outsideDir.dir, { "target.ts": "export {};\n" });
      await fs.symlink(
        path.join(outsideDir.dir, "target.ts"),
        path.join(temp.dir, "linked.ts"),
        "file",
      );
    } catch {
      ctx.skip(); // symlink creation needs elevation on Windows
      return;
    }

    await expect(workspace.readFile("linked.ts")).rejects.toThrow(WorkspaceError);
    await expect(workspace.writeFile("linked.ts", "used")).rejects.toThrow(
      WorkspaceError,
    );

    await outsideDir.cleanup();
  });

  it("refuses to create new files", async () => {
    await expect(workspace.writeFile("src/new.ts", "x")).rejects.toThrow(
      /Refusing to create/,
    );
  });

  it("writes existing files and leaves no temp files behind", async () => {
    await workspace.writeFile("src/a.ts", "export const users = ['bob'];\n");
    expect(await workspace.readFile("src/a.ts")).toBe("export const users = ['bob'];\n");
    const leftovers = (await fs.readdir(path.join(temp.dir, "src"))).filter((name) =>
      name.includes(".tmp"),
    );
    expect(leftovers).toEqual([]);
  });

  it("ranks filename matches above content matches", async () => {
    await writeFiles(temp.dir, {
      "src/hooks/useUsers.ts": "export function useUsers() {}\n",
      "src/notes.ts": "// mention of useusers in a comment\n",
    });
    const hits = await workspace.searchCode("useUsers");
    expect(hits[0]?.file).toBe("src/hooks/useUsers.ts");
    expect(hits.length).toBeGreaterThan(1);
  });

  it("returns no hits for a query made only of single characters", async () => {
    expect(await workspace.searchCode("a b c")).toEqual([]);
  });
});

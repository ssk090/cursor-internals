import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../src/context/workspace.js";
import { EditError, ProposalStore } from "../src/editing/proposal.js";
import { makeTempDir, writeFiles, type TempDir } from "./helpers.js";

const ORIGINAL = ["const a = 1;", "const b = 2;", "const c = 3;", ""].join("\n");

describe("ProposalStore", () => {
  let temp: TempDir;
  let workspace: Workspace;

  beforeEach(async () => {
    temp = await makeTempDir();
    await writeFiles(temp.dir, { "src/a.ts": ORIGINAL });
    workspace = new Workspace(temp.dir);
  });

  afterEach(async () => {
    await temp.cleanup();
  });

  it("stages an exact unique replacement without touching disk", async () => {
    const store = new ProposalStore(workspace);
    const edit = await store.propose("src/a.ts", "const b = 2;", "const b = 20;");
    expect(edit.original).toBe(ORIGINAL);
    expect(edit.updated).toContain("const b = 20;");
    expect(await workspace.readFile("src/a.ts")).toBe(ORIGINAL);
  });

  it("rejects text that does not appear", async () => {
    const store = new ProposalStore(workspace);
    await expect(
      store.propose("src/a.ts", "const d = 4;", "const d = 5;"),
    ).rejects.toThrow(EditError);
  });

  it("rejects ambiguous matches", async () => {
    const store = new ProposalStore(workspace);
    await expect(store.propose("src/a.ts", "const", "let")).rejects.toThrow(
      /matches 3 locations/,
    );
  });

  it("composes multiple edits to the same file in order", async () => {
    const store = new ProposalStore(workspace);
    await store.propose("src/a.ts", "const a = 1;", "const a = 10;");
    const edit = await store.propose("src/a.ts", "const a = 10;", "const a = 100;");
    expect(edit.original).toBe(ORIGINAL);
    expect(edit.updated).toContain("const a = 100;");
    expect(edit.updated).not.toContain("const a = 10;");
    expect(store.list()).toHaveLength(1);
  });

  it("rejects an empty oldText", async () => {
    const store = new ProposalStore(workspace);
    await expect(store.propose("src/a.ts", "", "x")).rejects.toThrow(/must not be empty/);
  });

  it("hints when only whitespace differs", async () => {
    const store = new ProposalStore(workspace);
    await expect(
      store.propose("src/a.ts", "const b = 2;   ", "x"),
    ).rejects.toThrow(/whitespace/);
  });
});

/**
 * What this proves: approved edits apply, drift is detected before writing,
 * and a partial failure rolls back what was already written.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../src/context/workspace.js";
import { StaleEditError, applyEdits } from "../src/editing/apply.js";
import { ProposalStore } from "../src/editing/proposal.js";
import { makeTempDir, writeFiles, type TempDir } from "./helpers.js";

const A = "export const a = 1;\n";
const B = "export const b = 2;\n";

class FailingWorkspace extends Workspace {
  failOn = "";

  override async writeFile(file: string, content: string): Promise<void> {
    if (file === this.failOn) {
      throw new Error(`simulated write failure on ${file}`);
    }
    return super.writeFile(file, content);
  }
}

describe("applyEdits", () => {
  let temp: TempDir;

  beforeEach(async () => {
    temp = await makeTempDir();
    await writeFiles(temp.dir, { "src/a.ts": A, "src/b.ts": B });
  });

  afterEach(async () => {
    await temp.cleanup();
  });

  it("applies all staged edits", async () => {
    const workspace = new Workspace(temp.dir);
    const store = new ProposalStore(workspace);
    await store.propose("src/a.ts", "a = 1", "a = 111");
    await store.propose("src/b.ts", "b = 2", "b = 222");

    const applied = await applyEdits(workspace, store.list());
    expect(applied.sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(await workspace.readFile("src/a.ts")).toContain("a = 111");
    expect(await workspace.readFile("src/b.ts")).toContain("b = 222");
  });

  it("refuses to apply when a file changed after staging", async () => {
    const workspace = new Workspace(temp.dir);
    const store = new ProposalStore(workspace);
    await store.propose("src/a.ts", "a = 1", "a = 111");

    // Someone else edits the file while the diff is under review.
    await workspace.writeFile("src/a.ts", "export const a = 999;\n");

    await expect(applyEdits(workspace, store.list())).rejects.toThrow(StaleEditError);
    expect(await workspace.readFile("src/a.ts")).toBe("export const a = 999;\n");
  });

  it("rolls back already-written files when a later write fails", async () => {
    const workspace = new FailingWorkspace(temp.dir);
    const store = new ProposalStore(workspace);
    await store.propose("src/a.ts", "a = 1", "a = 111");
    await store.propose("src/b.ts", "b = 2", "b = 222");
    workspace.failOn = "src/b.ts";

    await expect(applyEdits(workspace, store.list())).rejects.toThrow(/Rolled back 1\/1/);
    expect(await workspace.readFile("src/a.ts")).toBe(A);
    expect(await workspace.readFile("src/b.ts")).toBe(B);
  });
});

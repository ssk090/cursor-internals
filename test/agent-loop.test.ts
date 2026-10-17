import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/agent/events.js";
import { runAgent } from "../src/agent/loop.js";
import { ScriptedModelClient } from "../src/agent/model.js";
import { Workspace } from "../src/context/workspace.js";
import { makeTempDir, writeFiles, type TempDir } from "./helpers.js";

const USERS_FILE = "src/users.ts";
const USERS_CONTENT = "export function listUsers() {\n  return [];\n}\n";

describe("runAgent", () => {
  let temp: TempDir;
  let workspace: Workspace;

  beforeEach(async () => {
    temp = await makeTempDir();
    await writeFiles(temp.dir, { [USERS_FILE]: USERS_CONTENT });
    workspace = new Workspace(temp.dir);
  });

  afterEach(async () => {
    await temp.cleanup();
  });

  it("searches, reads, stages an edit, and stops", async () => {
    const events: AgentEvent[] = [];
    const model = new ScriptedModelClient([
      () => [{ name: "search_code", arguments: { query: "list users" } }],
      (ctx) => {
        expect(ctx.lastOutputFor("search_code")).toContain(USERS_FILE);
        return [{ name: "read_file", arguments: { file: USERS_FILE } }];
      },
      (ctx) => {
        expect(ctx.lastOutputFor("read_file")).toBe(USERS_CONTENT);
        return [
          {
            name: "propose_edit",
            arguments: {
              file: USERS_FILE,
              oldText: "  return [];",
              newText: "  return [1, 2, 3];",
            },
          },
        ];
      },
    ]);

    const edits = await runAgent(workspace, "make listUsers return users", {
      model,
      onEvent: (event) => events.push(event),
    });

    expect(edits).toHaveLength(1);
    expect(edits[0]?.updated).toContain("return [1, 2, 3];");
    // Staged only — the file on disk is untouched until approval.
    expect(await workspace.readFile(USERS_FILE)).toBe(USERS_CONTENT);

    expect(events.some((event) => event.type === "searching")).toBe(true);
    expect(events.some((event) => event.type === "reading")).toBe(true);
    expect(events.some((event) => event.type === "staged")).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      edits: 1,
      steps: 4,
    });
  });

  it("feeds tool errors back so the model can recover", async () => {
    const model = new ScriptedModelClient([
      () => [
        {
          name: "propose_edit",
          arguments: { file: USERS_FILE, oldText: "does not exist", newText: "x" },
        },
      ],
      (ctx) => {
        expect(ctx.lastOutputFor("propose_edit")).toContain("not found");
        return [
          {
            name: "propose_edit",
            arguments: {
              file: USERS_FILE,
              oldText: "  return [];",
              newText: "  return [42];",
            },
          },
        ];
      },
    ]);

    const toolErrors: AgentEvent[] = [];
    const edits = await runAgent(workspace, "fix it", {
      model,
      onEvent: (event) => {
        if (event.type === "tool_error") toolErrors.push(event);
      },
    });

    expect(toolErrors).toHaveLength(1);
    expect(edits[0]?.updated).toContain("return [42];");
  });

  it("throws when the step limit is reached", async () => {
    const model = new ScriptedModelClient([
      () => [{ name: "search_code", arguments: { query: "one" } }],
      () => [{ name: "search_code", arguments: { query: "two" } }],
      () => [{ name: "search_code", arguments: { query: "three" } }],
    ]);

    await expect(
      runAgent(workspace, "never finishes", { model, maxSteps: 2 }),
    ).rejects.toThrow(/step limit/);
  });

  it("uses the injected retrieval strategy for search_code", async () => {
    const model = new ScriptedModelClient([
      () => [{ name: "search_code", arguments: { query: "anything" } }],
    ]);
    const custom = async (query: string) => [{ file: `custom:${query}`, score: 1 }];
    const events: AgentEvent[] = [];
    await runAgent(workspace, "search", {
      model,
      search: custom,
      searchLabel: "custom",
      onEvent: (event) => events.push(event),
    });
    const searching = events.find((event) => event.type === "searching");
    expect(searching).toMatchObject({
      type: "searching",
      strategy: "custom",
      hits: [{ file: "custom:anything", score: 1 }],
    });
  });
});

import { describe, expect, it } from "vitest";
import { Workspace } from "../src/context/workspace.js";
import {
  resolveWorkspaceChecks,
  runCheck,
  stripAnsi,
} from "../src/validation/checks.js";
import { makeTempDir, writeFiles } from "./helpers.js";

describe("stripAnsi", () => {
  it("removes color escapes", () => {
    expect(stripAnsi("\u001b[32mPASS\u001b[0m")).toBe("PASS");
  });
});

describe("runCheck", () => {
  it("reports passing commands", async () => {
    const temp = await makeTempDir();
    try {
      const result = await runCheck(temp.dir, `node -e "process.exit(0)"`);
      expect(result.passed).toBe(true);
      expect(result.exitCode).toBe(0);
    } finally {
      await temp.cleanup();
    }
  });

  it("reports failing commands with captured output", async () => {
    const temp = await makeTempDir();
    try {
      const result = await runCheck(
        temp.dir,
        `node -e "console.error('boom'); process.exit(3)"`,
      );
      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(3);
      expect(result.output).toContain("boom");
    } finally {
      await temp.cleanup();
    }
  });
});

describe("resolveWorkspaceChecks", () => {
  it("reads declared typecheck/test scripts from package.json", async () => {
    const temp = await makeTempDir();
    try {
      await writeFiles(temp.dir, {
        "package.json": JSON.stringify({
          scripts: { test: "vitest run", typecheck: "tsc --noEmit", other: "x" },
        }),
      });
      const checks = await resolveWorkspaceChecks(new Workspace(temp.dir));
      expect(checks).toEqual(["npm run typecheck", "npm test"]);
    } finally {
      await temp.cleanup();
    }
  });

  it("returns nothing when the repo declares no scripts", async () => {
    const temp = await makeTempDir();
    try {
      const checks = await resolveWorkspaceChecks(new Workspace(temp.dir));
      expect(checks).toEqual([]);
    } finally {
      await temp.cleanup();
    }
  });
});

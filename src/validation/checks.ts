import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { Workspace } from "../context/workspace.js";

export type CheckResult = {
  command: string;
  passed: boolean;
  exitCode: number | null;
  output: string;
  durationMs: number;
};

const MAX_OUTPUT_CHARS = 50_000;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

/**
 * Default checks come from the repository's own declared scripts — nothing is
 * guessed. A repo that declares neither `typecheck` nor `test` is skipped.
 * Custom commands can be passed via `--validate-cmd`.
 */
export async function resolveWorkspaceChecks(
  workspace: Workspace,
): Promise<string[]> {
  const manifestPath = path.join(workspace.root, "package.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch {
    return [];
  }
  const scripts =
    (manifest as { scripts?: Record<string, string> }).scripts ?? {};
  const commands: string[] = [];
  if (scripts["typecheck"]) commands.push("npm run typecheck");
  if (scripts["test"]) commands.push("npm test");
  return commands;
}

/**
 * Run one validation command in the workspace root. Commands run through the
 * platform shell because they are user-approved strings (`npm test`, etc.).
 * Output is capped so a runaway check cannot flood the transcript.
 */
export async function runCheck(
  root: string,
  command: string,
  options: { timeoutMs?: number } = {},
): Promise<CheckResult> {
  const started = Date.now();
  return new Promise<CheckResult>((resolve) => {
    const child = spawn(command, { cwd: root, shell: true });
    let output = "";

    const collect = (chunk: Buffer): void => {
      if (output.length < MAX_OUTPUT_CHARS) {
        output += chunk.toString("utf8");
      }
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      output += `\n[mini-cursor] timed out after ${timeoutMs} ms; killing the process.`;
      child.kill();
    }, timeoutMs);

    let settled = false;
    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        command,
        passed: exitCode === 0,
        exitCode,
        output: stripAnsi(output),
        durationMs: Date.now() - started,
      });
    };

    child.on("error", (error) => {
      output += `\n[mini-cursor] failed to spawn: ${error.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

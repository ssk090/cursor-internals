import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { AgentEvent } from "./agent/events.js";
import { runAgent } from "./agent/loop.js";
import { OpenAIModelClient, type ModelClient } from "./agent/model.js";
import { FIXTURE_DEMO_TASK, createFixtureDemoClient } from "./agent/offline.js";
import { OpenAIEmbedder } from "./context/embedder.js";
import { makeHybridSearch, type SearchStrategy } from "./context/search.js";
import { Workspace } from "./context/workspace.js";
import { StaleEditError, applyEdits } from "./editing/apply.js";
import { diffStats, unifiedDiff } from "./editing/diff.js";
import type { StagedEdit } from "./editing/proposal.js";
import { resolveWorkspaceChecks, runCheck } from "./validation/checks.js";

type CliOptions = {
  root: string;
  task: string;
  mock: boolean;
  model?: string;
  retrieval: "lexical" | "hybrid";
  maxSteps: number;
  dryRun: boolean;
  yes: boolean;
  validate: boolean;
  validateCommands: string[];
  logPath?: string;
};

class UsageError extends Error {}

function printUsage(): void {
  console.log(
    [
      "mini-cursor — a repository editing agent that proposes, you approve.",
      "",
      "Usage:",
      '  npm run dev -- <repo> "<task>" [options]',
      "",
      "Options:",
      "  --model <id>         Model id (default: $OPENAI_MODEL or gpt-5.4)",
      "  --retrieval <mode>   lexical | hybrid (embeddings + RRF, needs an API key)",
      "  --max-steps <n>      Tool-loop step limit (default: 15)",
      "  --mock               Offline demo: replay a canned plan for the bundled fixture",
      "  --dry-run            Show diffs but never write",
      "  --yes, -y            Apply without the interactive approval prompt",
      "  --validate           Run the repo's typecheck/test scripts after applying",
      "  --validate-cmd <c>   Run a custom command after applying (repeatable)",
      "  --log <file>         Write agent events as JSONL",
      "  --help, -h           Show this help",
      "",
      "Examples:",
      '  npm run dev -- fixtures/sample-react-app "Add a search input to the users table"',
      "  npm run dev -- fixtures/sample-react-app --mock --dry-run",
      '  npm run dev -- ./some-repo "Fix the stale closure" --validate --log experiments/runs/run.jsonl',
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions | "help" {
  const options: CliOptions = {
    root: "",
    task: "",
    mock: false,
    retrieval: "lexical",
    maxSteps: 15,
    dryRun: false,
    yes: false,
    validate: false,
    validateCommands: [],
  };
  const positional: string[] = [];

  let i = 0;
  const next = (flag: string): string => {
    i += 1;
    const value = argv[i];
    if (value === undefined) throw new UsageError(`Missing value for ${flag}`);
    return value;
  };

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return "help";
    else if (arg === "--mock") options.mock = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--validate") options.validate = true;
    else if (arg === "--model") options.model = next(arg);
    else if (arg === "--retrieval") {
      const value = next(arg);
      if (value !== "lexical" && value !== "hybrid") {
        throw new UsageError("--retrieval must be lexical or hybrid");
      }
      options.retrieval = value;
    } else if (arg === "--max-steps") {
      const value = Number.parseInt(next(arg), 10);
      if (!Number.isInteger(value) || value <= 0) {
        throw new UsageError("--max-steps must be a positive integer");
      }
      options.maxSteps = value;
    } else if (arg === "--validate-cmd") options.validateCommands.push(next(arg));
    else if (arg === "--log") options.logPath = next(arg);
    else if (arg.startsWith("--")) throw new UsageError(`Unknown flag: ${arg}`);
    else positional.push(arg);
    i += 1;
  }

  const [root, ...taskParts] = positional;
  if (!root) throw new UsageError("Missing <repo> argument");
  options.root = root;
  options.task = taskParts.join(" ");
  if (!options.task && options.mock) {
    options.task = FIXTURE_DEMO_TASK;
  }
  if (!options.task) {
    throw new UsageError('Missing "<task>" argument (or use --mock for the offline demo)');
  }
  return options;
}

function renderEvent(event: AgentEvent): void {
  switch (event.type) {
    case "searching": {
      const files = event.hits.map((hit) => hit.file);
      const shown =
        files.length === 0
          ? "no hits"
          : files.slice(0, 5).join(", ") +
            (files.length > 5 ? ` (+${files.length - 5} more)` : "");
      console.log(`  [search:${event.strategy}] "${event.query}" -> ${shown}`);
      break;
    }
    case "reading":
      console.log(`  [read] ${event.file} (${event.bytes} bytes)`);
      break;
    case "proposing":
      console.log(`  [propose] ${event.file}`);
      break;
    case "staged":
      console.log(`  [staged] ${event.file} (${event.totalStaged} file(s) staged)`);
      break;
    case "message":
      console.log(`  [agent] ${event.text.trim()}`);
      break;
    case "tool_error":
      console.log(`  [tool error:${event.tool}] ${event.message}`);
      break;
    case "completed": {
      const usage = event.usage
        ? ` tokens: ${event.usage.inputTokens} in / ${event.usage.outputTokens} out`
        : "";
      console.log(
        `  [done] ${event.edits} edit(s) staged in ${event.steps} step(s)${usage}`,
      );
      break;
    }
  }
}

async function writeEventLog(logPath: string, lines: string[]): Promise<void> {
  const resolved = path.resolve(logPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, lines.length > 0 ? lines.join("\n") + "\n" : "", "utf8");
}

async function main(argv: string[]): Promise<void> {
  let options: CliOptions | "help";
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exitCode = 2;
    return;
  }
  if (options === "help") {
    printUsage();
    return;
  }

  const workspace = new Workspace(options.root);
  await workspace.assertReady();

  // ---------------------------------------------------------------- model
  let model: ModelClient;
  if (options.mock) {
    model = createFixtureDemoClient();
  } else {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in, or run `npm run demo` for the offline demo.",
      );
    }
    model = new OpenAIModelClient({
      model: options.model ?? process.env.OPENAI_MODEL ?? "gpt-5.4",
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL,
    });
  }

  // ------------------------------------------------------------ retrieval
  let search: SearchStrategy | undefined;
  let searchLabel = "lexical";
  if (options.retrieval === "hybrid") {
    if (options.mock) {
      console.log("[retrieval] hybrid requested; the offline demo stays on lexical.");
    } else {
      search = makeHybridSearch(workspace, new OpenAIEmbedder());
      searchLabel = "hybrid(rrf)";
    }
  }

  // ---------------------------------------------------------------- run
  const logLines: string[] = [];
  const onEvent = (event: AgentEvent): void => {
    renderEvent(event);
    if (options.logPath) {
      logLines.push(JSON.stringify({ ts: new Date().toISOString(), event }));
    }
  };

  console.log(`mini-cursor  repo: ${workspace.root}`);
  console.log(
    `model: ${model.label}  retrieval: ${searchLabel}  max steps: ${options.maxSteps}`,
  );
  if (options.mock) {
    console.log("offline demo mode: replaying a canned plan for the bundled fixture");
  }
  console.log(`task: ${options.task}\n`);

  let edits: StagedEdit[] = [];
  try {
    edits = await runAgent(workspace, options.task, {
      model,
      maxSteps: options.maxSteps,
      onEvent,
      search,
      searchLabel,
    });
  } finally {
    if (options.logPath) {
      await writeEventLog(options.logPath, logLines);
    }
  }

  if (edits.length === 0) {
    console.log("\nNo edits proposed.");
    return;
  }

  // --------------------------------------------------------------- review
  console.log(`\n${edits.length} file(s) with proposed changes:\n`);
  for (const edit of edits) {
    console.log(unifiedDiff(edit));
    const stats = diffStats(edit.original, edit.updated);
    console.log(`  ${edit.file}: +${stats.added} -${stats.removed}\n`);
  }

  if (options.dryRun) {
    console.log("Dry run: nothing was written.");
    return;
  }

  // ------------------------------------------------------------- approval
  let approved = options.yes;
  if (options.yes) {
    console.log("--yes given: applying without an interactive prompt.");
  } else if (!stdin.isTTY) {
    console.log(
      "No interactive terminal available; rerun with --yes to apply or --dry-run to inspect.",
    );
    return;
  } else {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      const answer = await rl.question("Apply all changes? (yes/no): ");
      approved = answer.trim().toLowerCase() === "yes";
    } finally {
      rl.close();
    }
  }

  if (!approved) {
    console.log("Changes rejected. Nothing was written.");
    return;
  }

  // ---------------------------------------------------------------- apply
  let appliedFiles: string[];
  try {
    appliedFiles = await applyEdits(workspace, edits);
  } catch (error) {
    if (error instanceof StaleEditError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  console.log(`Changes applied to ${appliedFiles.length} file(s): ${appliedFiles.join(", ")}`);

  // ----------------------------------------------------------- validation
  const commands = [...options.validateCommands];
  if (options.validate) {
    const detected = await resolveWorkspaceChecks(workspace);
    if (detected.length === 0) {
      console.log(
        "\nValidation requested, but the repository declares no typecheck/test scripts.",
      );
    }
    for (const command of detected) {
      if (!commands.includes(command)) commands.push(command);
    }
  }
  if (commands.length === 0) return;

  console.log("\nRunning validation:");
  let allPassed = true;
  for (const command of commands) {
    console.log(`\n$ ${command}`);
    const result = await runCheck(workspace.root, command);
    console.log(
      `[${result.passed ? "PASS" : "FAIL"}] ${command} (exit ${result.exitCode ?? "n/a"}, ${result.durationMs} ms)`,
    );
    const outputLines = result.output.trimEnd().split("\n").filter(Boolean);
    if (outputLines.length > 0) {
      const shown =
        outputLines.length > 40
          ? [
              ...outputLines.slice(0, 20),
              `... ${outputLines.length - 40} lines omitted ...`,
              ...outputLines.slice(-20),
            ]
          : outputLines;
      console.log(shown.join("\n"));
    }
    if (!result.passed) allPassed = false;
  }

  if (allPassed) {
    console.log("\nValidation passed.");
  } else {
    console.log(
      "\nValidation failed. The edits are applied; review with `git diff`, then `git restore .` to revert everything if needed.",
    );
    process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(
    `\n[mini-cursor] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});

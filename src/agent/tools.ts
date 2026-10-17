import type { SearchStrategy } from "../context/search.js";
import type { Workspace } from "../context/workspace.js";
import type { ProposalStore } from "../editing/proposal.js";
import type { AgentEventHandler } from "./events.js";
import type { ToolDef } from "./model.js";

export type ToolOutcome = { result: string; isError: boolean };

export type ToolContext = {
  workspace: Workspace;
  proposals: ProposalStore;
  emit: AgentEventHandler;
  search: SearchStrategy;
  searchLabel: string;
};

export const TOOL_DEFINITIONS: ToolDef[] = [
  {
    name: "search_code",
    description:
      "Search repository files by keyword. Returns up to 10 files ranked by relevance; " +
      "filename matches weigh more than content matches.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keywords to search for, e.g. 'users table search'.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description:
      "Read the exact contents of a repository file. Returns the raw text with no line numbers; " +
      "copy spans you want to edit verbatim from this output.",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Workspace-relative path, e.g. 'src/hooks/useUsers.ts'.",
        },
      },
      required: ["file"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_edit",
    description:
      "Stage a replacement of an exact, unique text span (oldText -> newText) in a file. " +
      "oldText must match exactly once in the file as it stands after any previously staged edits. " +
      "This does NOT write to disk; the user reviews diffs and approves before anything is written.",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Workspace-relative path of an existing file.",
        },
        oldText: {
          type: "string",
          description: "Exact text to replace, copied from read_file output.",
        },
        newText: {
          type: "string",
          description: "Replacement text (may be empty to delete the span).",
        },
      },
      required: ["file", "oldText", "newText"],
      additionalProperties: false,
    },
  },
];

function parseArguments(raw: string): Record<string, unknown> {
  if (raw.trim() === "") return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function requireString(
  args: Record<string, unknown>,
  key: string,
  options: { allowEmpty?: boolean } = {},
): string {
  const value = args[key];
  if (typeof value !== "string") {
    throw new Error(`Missing required string argument "${key}"`);
  }
  if (!options.allowEmpty && value.length === 0) {
    throw new Error(`Argument "${key}" must not be empty`);
  }
  return value;
}

/**
 * Execute one tool call. Errors are converted into `{ error }` JSON outputs
 * (and tool_error events) instead of crashing the loop, so the model can
 * adapt — matching the plan's loop design.
 */
export async function executeTool(
  context: ToolContext,
  name: string,
  rawArguments: string,
): Promise<ToolOutcome> {
  try {
    const args = parseArguments(rawArguments);

    switch (name) {
      case "search_code": {
        const query = requireString(args, "query");
        const hits = await context.search(query);
        context.emit({
          type: "searching",
          query,
          strategy: context.searchLabel,
          hits,
        });
        return { result: JSON.stringify({ matches: hits }), isError: false };
      }

      case "read_file": {
        const file = requireString(args, "file");
        const content = await context.workspace.readFile(file);
        context.emit({
          type: "reading",
          file,
          bytes: Buffer.byteLength(content, "utf8"),
        });
        return { result: content, isError: false };
      }

      case "propose_edit": {
        const file = requireString(args, "file");
        const oldText = requireString(args, "oldText", { allowEmpty: true });
        const newText = requireString(args, "newText", { allowEmpty: true });
        context.emit({ type: "proposing", file });
        const staged = await context.proposals.propose(file, oldText, newText);
        context.emit({
          type: "staged",
          file: staged.file,
          totalStaged: context.proposals.list().length,
        });
        return {
          result: JSON.stringify({
            status: "staged",
            file: staged.file,
            note: "Staged for user review. Nothing is written until the user approves.",
          }),
          isError: false,
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.emit({ type: "tool_error", tool: name, message });
    return { result: JSON.stringify({ error: message }), isError: true };
  }
}

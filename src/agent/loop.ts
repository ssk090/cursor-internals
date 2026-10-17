/**
 * The agent loop — the heart of mini-cursor.
 *
 * One "step" is one model turn:
 *   1. send the conversation so far to the model;
 *   2. append the items the model produced;
 *   3. if it requested no tools, we are done — return the staged edits;
 *   4. otherwise run each requested tool and append its result, then repeat.
 *
 * The model can search, read, and *stage* edits — it can never write files.
 * Writing happens later, in the CLI, after the user sees the diff.
 */
import { lexicalSearch, type SearchStrategy } from "../context/search.js";
import type { Workspace } from "../context/workspace.js";
import { ProposalStore, type StagedEdit } from "../editing/proposal.js";
import type { AgentEventHandler, TokenUsage } from "./events.js";
import type { ConversationItem, ModelClient } from "./model.js";
import { buildSystemPrompt } from "./prompts.js";
import { TOOL_DEFINITIONS, executeTool } from "./tools.js";

export type RunAgentOptions = {
  /** The model to drive the loop with (live OpenAI client or test double). */
  model: ModelClient;
  /** Tool-loop step limit (model turns). Plan default: 15. */
  maxSteps?: number;
  /** Called for every search, read, stage, message, error and completion. */
  onEvent?: AgentEventHandler;
  /** Retrieval strategy used by search_code. Defaults to lexical. */
  search?: SearchStrategy;
  /** Label shown in search events, e.g. "lexical" or "hybrid(rrf)". */
  searchLabel?: string;
  /** Override the system prompt (used by experiments/tests). */
  systemPrompt?: string;
};

const DEFAULT_MAX_STEPS = 15;

export async function runAgent(
  workspace: Workspace,
  task: string,
  options: RunAgentOptions,
): Promise<StagedEdit[]> {
  const emit = options.onEvent ?? (() => {});
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const proposals = new ProposalStore(workspace);
  const search =
    options.search ?? ((query: string) => lexicalSearch(workspace, query));
  const searchLabel = options.searchLabel ?? "lexical";

  // Everything said and done so far:
  //   "user"                 = the task,
  //   "assistant"            = items the model produced,
  //   "function_call_output" = results of the tools it requested.
  const conversation: ConversationItem[] = [{ kind: "user", text: task }];
  let usageTotal: TokenUsage | undefined;

  for (let step = 1; step <= maxSteps; step++) {
    // 1. Ask the model what to do next.
    const turn = await options.model.complete({
      system: options.systemPrompt ?? buildSystemPrompt(),
      items: conversation,
      tools: TOOL_DEFINITIONS,
    });

    // 2. Remember what it said, and accumulate token usage.
    conversation.push(...turn.outputItems);
    if (turn.usage) {
      usageTotal = {
        inputTokens: (usageTotal?.inputTokens ?? 0) + turn.usage.inputTokens,
        outputTokens: (usageTotal?.outputTokens ?? 0) + turn.usage.outputTokens,
      };
    }
    if (turn.text.trim().length > 0) {
      emit({ type: "message", text: turn.text });
    }

    // 3. No tool calls means the model considers the task finished.
    if (turn.calls.length === 0) {
      const edits = proposals.list();
      emit({ type: "completed", edits: edits.length, steps: step, usage: usageTotal });
      return edits;
    }

    // 4. Run every tool it asked for and feed the results back.
    for (const call of turn.calls) {
      const outcome = await executeTool(
        { workspace, proposals, emit, search, searchLabel },
        call.name,
        call.arguments,
      );
      conversation.push({
        kind: "function_call_output",
        callId: call.callId,
        output: outcome.result,
      });
    }
  }

  throw new Error(
    `Agent exceeded the ${maxSteps}-step limit without finishing. Nothing was written.`,
  );
}

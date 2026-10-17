import { lexicalSearch, type SearchStrategy } from "../context/search.js";
import type { Workspace } from "../context/workspace.js";
import { ProposalStore, type StagedEdit } from "../editing/proposal.js";
import type { AgentEventHandler, TokenUsage } from "./events.js";
import type { ConversationItem, ModelClient } from "./model.js";
import { buildSystemPrompt } from "./prompts.js";
import { TOOL_DEFINITIONS, executeTool } from "./tools.js";

export type RunAgentOptions = {
  model: ModelClient;
  /** Tool-loop step limit (model turns). Plan default: 15. */
  maxSteps?: number;
  onEvent?: AgentEventHandler;
  /** Retrieval strategy used by search_code. Defaults to lexical. */
  search?: SearchStrategy;
  searchLabel?: string;
  systemPrompt?: string;
};

const DEFAULT_MAX_STEPS = 15;

/**
 * The agent loop (plan section 5): ask the model for a turn, execute any
 * requested tools, feed results back, repeat until the model stops calling
 * tools or the step limit is hit. The model never writes files — edits are
 * staged in a ProposalStore for diff review and approval.
 */
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

  const items: ConversationItem[] = [{ kind: "user", text: task }];
  let usageTotal: TokenUsage | undefined;

  for (let step = 1; step <= maxSteps; step++) {
    const turn = await options.model.complete({
      system: options.systemPrompt ?? buildSystemPrompt(),
      items,
      tools: TOOL_DEFINITIONS,
    });

    items.push(...turn.newItems);

    if (turn.usage) {
      usageTotal = {
        inputTokens: (usageTotal?.inputTokens ?? 0) + turn.usage.inputTokens,
        outputTokens: (usageTotal?.outputTokens ?? 0) + turn.usage.outputTokens,
      };
    }

    if (turn.text.trim().length > 0) {
      emit({ type: "message", text: turn.text });
    }

    if (turn.calls.length === 0) {
      const edits = proposals.list();
      emit({ type: "completed", edits: edits.length, steps: step, usage: usageTotal });
      return edits;
    }

    for (const call of turn.calls) {
      const outcome = await executeTool(
        { workspace, proposals, emit, search, searchLabel },
        call.name,
        call.arguments,
      );
      items.push({
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

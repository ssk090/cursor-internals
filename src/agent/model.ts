/**
 * The only place that talks to an AI provider.
 *
 * The rest of the codebase speaks a tiny provider-neutral language
 * (`ConversationItem`, `ToolDef`, `ModelTurn`). Two implementations exist:
 *
 *   - OpenAIModelClient  — real calls to the OpenAI Responses API;
 *   - ScriptedModelClient — a deterministic test double that replays
 *     scripted tool calls (used by the test suite and the offline demo).
 *
 * Provider-specific output items (e.g. reasoning items) travel as opaque
 * `assistant` values and are echoed back verbatim, exactly as the Responses
 * API expects. That keeps the two small helper functions below the only
 * provider-specific code in the project.
 */
import OpenAI from "openai";
import type { TokenUsage } from "./events.js";

export type JsonSchema = Record<string, unknown>;

export type ToolDef = {
  name: string;
  description: string;
  parameters: JsonSchema;
};

/**
 * Provider-neutral conversation item. `assistant` wraps provider-specific
 * output items unchanged; nothing outside this file inspects them.
 */
export type ConversationItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; raw: unknown }
  | { kind: "function_call_output"; callId: string; output: string };

export type ParsedCall = { callId: string; name: string; arguments: string };

export type ModelTurn = {
  /** Tool calls the model requested this turn. */
  calls: ParsedCall[];
  /** Assistant text, if any (usually empty while tools are being used). */
  text: string;
  /** Items the provider produced; append these to the conversation. */
  outputItems: ConversationItem[];
  usage?: TokenUsage;
};

export type ModelRequest = {
  system: string;
  items: ConversationItem[];
  tools: ToolDef[];
};

export interface ModelClient {
  /** Shown in logs, e.g. "openai:gpt-5.4" or "scripted". */
  readonly label: string;
  complete(request: ModelRequest): Promise<ModelTurn>;
}

/* ---------------------------- OpenAI (live) ------------------------------ */

export type OpenAIModelOptions = {
  model: string;
  apiKey?: string;
  baseURL?: string;
  /** Inject a pre-configured client (tests, custom fetch). */
  client?: OpenAI;
};

export class OpenAIModelClient implements ModelClient {
  readonly label: string;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAIModelOptions) {
    this.client =
      options.client ?? new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL });
    this.model = options.model;
    this.label = `openai:${options.model}`;
  }

  async complete(request: ModelRequest): Promise<ModelTurn> {
    const response = await this.client.responses.create({
      model: this.model,
      instructions: request.system,
      tools: request.tools.map(toProviderTool),
      // The SDK types `input` as a strict union; our pass-through items are
      // intentionally provider-shaped, so the cast is confined to this line.
      input: toProviderInput(request.items) as never,
    });

    const calls: ParsedCall[] = [];
    const outputItems: ConversationItem[] = [];
    for (const item of response.output) {
      if (item.type === "function_call") {
        calls.push({
          callId: item.call_id,
          name: item.name,
          arguments: item.arguments,
        });
      }
      outputItems.push({ kind: "assistant", raw: item });
    }

    return {
      calls,
      text: response.output_text ?? "",
      outputItems,
      usage: mapUsage(response.usage),
    };
  }
}

/** Our ToolDef -> a Responses API function tool. */
function toProviderTool(tool: ToolDef) {
  return {
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: true,
  };
}

/**
 * The neutral conversation -> the Responses API `input` array. Previous
 * provider items must be passed back unchanged, so they go through as-is.
 */
function toProviderInput(items: ConversationItem[]): unknown[] {
  return items.map((item) => {
    switch (item.kind) {
      case "user":
        return { role: "user", content: item.text };
      case "assistant":
        return item.raw;
      case "function_call_output":
        return {
          type: "function_call_output",
          call_id: item.callId,
          output: item.output,
        };
    }
  });
}

/** The SDK's usage object is loosely typed; pull out the two numbers we show. */
function mapUsage(usage: unknown): TokenUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const record = usage as Record<string, unknown>;
  const input = record.input_tokens;
  const output = record.output_tokens;
  if (typeof input !== "number" || typeof output !== "number") return undefined;
  return { inputTokens: input, outputTokens: output };
}

/* ------------------------- Scripted (tests/demo) ------------------------- */

export type ScriptContext = {
  turn: number;
  outputsByCall: Map<string, string>;
  lastOutputFor: (toolName: string) => string | undefined;
};

export type ScriptedToolCall = { name: string; arguments: Record<string, unknown> };

/** One scripted model turn: return tool calls, or null to finish. */
export type ScriptedTurn = (context: ScriptContext) => ScriptedToolCall[] | null;

/**
 * Deterministic stand-in for a model: replays scripted tool calls turn by
 * turn and can inspect previous tool outputs. Used by the test suite and by
 * the offline demo mode (`--mock`) so the whole pipeline is runnable without
 * API credentials. It is a test double, not a model.
 */
export class ScriptedModelClient implements ModelClient {
  readonly label = "scripted";
  private index = 0;
  private readonly callNames = new Map<string, string>();

  constructor(
    private readonly turns: ScriptedTurn[],
    private readonly finalText = "Finished.",
  ) {}

  async complete(request: ModelRequest): Promise<ModelTurn> {
    // Collect what previous tools returned, so scripted turns can react to it.
    const outputsByCall = new Map<string, string>();
    const lastByTool = new Map<string, string>();
    for (const item of request.items) {
      if (item.kind === "function_call_output") {
        outputsByCall.set(item.callId, item.output);
        const name = this.callNames.get(item.callId);
        if (name) lastByTool.set(name, item.output);
      }
    }

    const turn = this.turns[this.index];
    const turnNumber = this.index + 1;
    this.index += 1;

    if (!turn) {
      return { calls: [], text: this.finalText, outputItems: [] };
    }

    const produced = turn({
      turn: turnNumber,
      outputsByCall,
      lastOutputFor: (toolName) => lastByTool.get(toolName),
    });

    if (!produced || produced.length === 0) {
      return { calls: [], text: this.finalText, outputItems: [] };
    }

    const calls = produced.map((call, callIndex) => {
      const callId = `scripted_${turnNumber}_${callIndex}`;
      this.callNames.set(callId, call.name);
      return { callId, name: call.name, arguments: JSON.stringify(call.arguments) };
    });

    // The scripted client reads tool outputs straight from the conversation,
    // so it does not need its own items echoed back.
    return { calls, text: "", outputItems: [] };
  }
}

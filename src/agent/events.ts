import type { SearchHit } from "../context/workspace.js";

export type TokenUsage = { inputTokens: number; outputTokens: number };

/**
 * The event model the CLI renders today and the future React UI will stream
 * over SSE (plan section 7). Superset of the plan's sketch: hits, byte counts,
 * tool errors, and token usage are included so experiments can record timing
 * and cost data without instrumenting the loop.
 */
export type AgentEvent =
  | { type: "searching"; query: string; strategy: string; hits: SearchHit[] }
  | { type: "reading"; file: string; bytes: number }
  | { type: "proposing"; file: string }
  | { type: "staged"; file: string; totalStaged: number }
  | { type: "message"; text: string }
  | { type: "tool_error"; tool: string; message: string }
  | { type: "completed"; edits: number; steps: number; usage?: TokenUsage };

export type AgentEventHandler = (event: AgentEvent) => void;

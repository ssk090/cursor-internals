import OpenAI from "openai";
import type { Embedder } from "./search.js";

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Real embeddings via the OpenAI API. Retrieval works without it (lexical
 * baseline); this is opt-in through `--retrieval hybrid`.
 */
export class OpenAIEmbedder implements Embedder {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: { client?: OpenAI; model?: string } = {}) {
    this.client = options.client ?? new OpenAI();
    this.model =
      options.model ?? process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
    });
    return response.data.map((entry) => entry.embedding);
  }
}

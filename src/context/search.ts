/**
 * Retrieval strategies for the `search_code` tool, simplest first:
 *
 *   lexicalSearch    filename + keyword scoring (see context/workspace.ts)
 *   embeddingSearch  cosine similarity over per-file embeddings; the small
 *                    Embedder interface keeps this testable offline
 *   makeHybridSearch lexical + semantic, fused with Reciprocal Rank Fusion
 *
 * RRF fuses *ranks*, not scores, so the two strategies' incomparable score
 * scales never meet:  RRF(d) = sum over rankings of 1 / (60 + rank(d)).
 */
import type { SearchHit } from "./workspace.js";
import type { Workspace } from "./workspace.js";

export type { SearchHit } from "./workspace.js";

export const TOP_K = 10;

const EMBEDDING_MAX_CHARS = 4000;
const EMBEDDING_MAX_FILES = 300;

/** Anything that can turn text into vectors. Keeps retrieval testable offline. */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export type SearchStrategy = (query: string) => Promise<SearchHit[]>;

export async function lexicalSearch(
  workspace: Workspace,
  query: string,
): Promise<SearchHit[]> {
  return workspace.searchCode(query);
}

/**
 * Reciprocal Rank Fusion (plan formula):
 *   RRF(d) = sum over rankings r of 1 / (60 + rank_r(d))
 * Ranks, not raw scores, are fused so incomparable score scales never meet.
 */
export function reciprocalRankFusion(
  rankings: SearchHit[][],
  k = 60,
): SearchHit[] {
  const fused = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((hit, index) => {
      const rank = index + 1;
      const contribution = 1 / (k + rank);
      fused.set(hit.file, (fused.get(hit.file) ?? 0) + contribution);
    });
  }
  return [...fused.entries()]
    .map(([file, score]) => ({ file, score }))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, TOP_K);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * MVP semantic retrieval: one embedding per file (first 4000 chars).
 * Per-function chunking (tree-sitter / TypeScript compiler API) is the
 * documented next step — see README "Known limits".
 */
export async function embeddingSearch(
  workspace: Workspace,
  query: string,
  embedder: Embedder,
): Promise<SearchHit[]> {
  const files = (await workspace.listFiles()).slice(0, EMBEDDING_MAX_FILES);
  const candidates: Array<{ file: string; text: string }> = [];
  for (const file of files) {
    try {
      const text = (await workspace.readFile(file)).slice(0, EMBEDDING_MAX_CHARS);
      candidates.push({ file, text });
    } catch {
      // unreadable, too large, or denied
    }
  }
  if (candidates.length === 0) return [];

  const [queryVector] = await embedder.embed([query]);
  if (!queryVector) return [];
  const vectors = await embedder.embed(candidates.map((candidate) => candidate.text));

  return candidates
    .map((candidate, index) => ({
      file: candidate.file,
      score: cosineSimilarity(queryVector, vectors[index] ?? []),
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, TOP_K);
}

export function makeHybridSearch(
  workspace: Workspace,
  embedder: Embedder,
): SearchStrategy {
  return async (query: string) => {
    const [lexical, semantic] = await Promise.all([
      lexicalSearch(workspace, query),
      embeddingSearch(workspace, query, embedder),
    ]);
    return reciprocalRankFusion([lexical, semantic]);
  };
}

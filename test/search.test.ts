import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  embeddingSearch,
  makeHybridSearch,
  reciprocalRankFusion,
  type Embedder,
} from "../src/context/search.js";
import { Workspace } from "../src/context/workspace.js";
import { makeTempDir, writeFiles, type TempDir } from "./helpers.js";

/** Deterministic bag-of-words embedder over a tiny vocabulary. */
class FakeEmbedder implements Embedder {
  private readonly vocabulary = [
    "user",
    "users",
    "table",
    "search",
    "api",
    "auth",
    "format",
  ];

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const lower = text.toLowerCase();
      return this.vocabulary.map((word) => (lower.includes(word) ? 1 : 0));
    });
  }
}

describe("reciprocalRankFusion", () => {
  it("rewards documents that rank well in multiple lists", () => {
    const lexical = [
      { file: "a.ts", score: 10 },
      { file: "b.ts", score: 8 },
      { file: "c.ts", score: 6 },
    ];
    const semantic = [
      { file: "b.ts", score: 0.9 },
      { file: "d.ts", score: 0.8 },
    ];
    const fused = reciprocalRankFusion([lexical, semantic]);
    expect(fused[0]?.file).toBe("b.ts");
    expect(fused.map((hit) => hit.file).sort()).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
      "d.ts",
    ]);
  });

  it("uses ranks, not raw scores", () => {
    const listA = [{ file: "a.ts", score: 10_000_000 }];
    const listB = [{ file: "b.ts", score: 0.0000001 }];
    const fused = reciprocalRankFusion([listA, listB]);
    expect(fused[0]?.score).toBeCloseTo(fused[1]?.score ?? -1, 10);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for parallel and 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("is 0 when either side is the zero vector", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("embeddingSearch + hybrid retrieval", () => {
  let temp: TempDir;
  let workspace: Workspace;

  beforeEach(async () => {
    temp = await makeTempDir();
    await writeFiles(temp.dir, {
      "src/api/users.ts":
        "export async function fetchUsers() { return get('/api/users'); }\n",
      "src/api/auth.ts":
        "export async function refreshToken() { return get('/api/session'); }\n",
      "src/utils/format.ts": "export function formatUserName() {}\n",
    });
    workspace = new Workspace(temp.dir);
  });

  afterEach(async () => {
    await temp.cleanup();
  });

  it("finds files by meaning when keyword weighting is weak", async () => {
    const hits = await embeddingSearch(workspace, "api users table", new FakeEmbedder());
    expect(hits[0]?.file).toBe("src/api/users.ts");
  });

  it("hybrid search fuses lexical and semantic candidates", async () => {
    const hybrid = makeHybridSearch(workspace, new FakeEmbedder());
    const hits = await hybrid("auth token");
    const files = hits.map((hit) => hit.file);
    expect(files).toContain("src/api/auth.ts");
  });
});

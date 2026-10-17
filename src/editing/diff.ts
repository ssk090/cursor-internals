import { createPatch, diffLines } from "diff";
import type { StagedEdit } from "./proposal.js";

export function unifiedDiff(
  edit: Pick<StagedEdit, "file" | "original" | "updated">,
): string {
  return createPatch(edit.file, edit.original, edit.updated);
}

export type DiffStats = { added: number; removed: number };

function countLines(value: string): number {
  if (value.length === 0) return 0;
  const newlines = value.match(/\n/g)?.length ?? 0;
  return value.endsWith("\n") ? newlines : newlines + 1;
}

export function diffStats(original: string, updated: string): DiffStats {
  let added = 0;
  let removed = 0;
  for (const part of diffLines(original, updated)) {
    const lines =
      typeof part.count === "number" ? part.count : countLines(part.value);
    if (part.added) added += lines;
    else if (part.removed) removed += lines;
  }
  return { added, removed };
}

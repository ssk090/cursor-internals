/**
 * Staged edits — the model never writes files.
 *
 * `ProposalStore` collects the edits proposed during an agent run. Two rules
 * keep them shippable (covered by test/proposal.test.ts):
 *
 *   1. oldText must match exactly once in the file *as staged so far*, so
 *      several edits to one file compose in order and ambiguous edits fail
 *      with an actionable error.
 *   2. `original` is captured the first time a file is edited; the apply step
 *      refuses to write if the file no longer matches it (drift detection).
 */
import type { Workspace } from "../context/workspace.js";

export type StagedEdit = {
  file: string;
  /** File content at the time the first edit for this file was staged. */
  original: string;
  /** Content after all staged replacements for this file. */
  updated: string;
};

export class EditError extends Error {}

/** How many non-overlapping times `needle` appears in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  return haystack.split(needle).length - 1;
}

export class ProposalStore {
  private readonly staged = new Map<string, StagedEdit>();

  constructor(private readonly workspace: Workspace) {}

  /** All files staged so far, one entry per file. */
  list(): StagedEdit[] {
    return [...this.staged.values()];
  }

  async propose(file: string, oldText: string, newText: string): Promise<StagedEdit> {
    if (oldText.length === 0) {
      throw new EditError("oldText must not be empty");
    }

    // Validate against the file as edited so far, so multiple proposals for
    // the same file compose in order.
    const alreadyStaged = this.staged.get(file);
    const currentContent = alreadyStaged
      ? alreadyStaged.updated
      : await this.workspace.readFile(file);

    const occurrences = countOccurrences(currentContent, oldText);
    if (occurrences === 0) {
      const hint = currentContent.includes(oldText.trim())
        ? " The text is present but with different whitespace — copy indentation and newlines exactly from read_file."
        : "";
      throw new EditError(
        `oldText was not found in ${file}. Re-read the file and copy the exact text.${hint}`,
      );
    }
    if (occurrences > 1) {
      throw new EditError(
        `oldText matches ${occurrences} locations in ${file}. Include more surrounding context so the match is unique.`,
      );
    }

    const index = currentContent.indexOf(oldText);
    const updated =
      currentContent.slice(0, index) +
      newText +
      currentContent.slice(index + oldText.length);

    const staged: StagedEdit = {
      file,
      original: alreadyStaged ? alreadyStaged.original : currentContent,
      updated,
    };
    this.staged.set(file, staged);
    return staged;
  }
}

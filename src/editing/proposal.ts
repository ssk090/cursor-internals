import type { Workspace } from "../context/workspace.js";

export type StagedEdit = {
  file: string;
  /** File content at the time the first edit for this file was staged. */
  original: string;
  /** Content after all staged replacements for this file. */
  updated: string;
};

export class EditError extends Error {}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Holds the edits proposed by the agent before anything touches disk.
 *
 * Invariants:
 * - oldText must match exactly once in the file *as staged so far* (so several
 *   edits to one file compose in order, and ambiguous edits are rejected).
 * - `original` is captured the first time a file is edited; the apply step
 *   refuses to write if the file no longer matches it (drift detection).
 */
export class ProposalStore {
  private readonly staged = new Map<string, StagedEdit>();

  constructor(private readonly workspace: Workspace) {}

  list(): StagedEdit[] {
    return [...this.staged.values()];
  }

  async propose(file: string, oldText: string, newText: string): Promise<StagedEdit> {
    if (oldText.length === 0) {
      throw new EditError("oldText must not be empty");
    }

    const previous = this.staged.get(file);
    const current = previous ? previous.updated : await this.workspace.readFile(file);

    const occurrences = countOccurrences(current, oldText);
    if (occurrences === 0) {
      const hint = current.includes(oldText.trim())
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

    const index = current.indexOf(oldText);
    const updated =
      current.slice(0, index) + newText + current.slice(index + oldText.length);

    const staged: StagedEdit = {
      file,
      original: previous ? previous.original : current,
      updated,
    };
    this.staged.set(file, staged);
    return staged;
  }
}

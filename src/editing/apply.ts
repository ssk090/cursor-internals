import type { Workspace } from "../context/workspace.js";
import type { StagedEdit } from "./proposal.js";

export class StaleEditError extends Error {}

/**
 * Refuse to apply when any file changed after the edit was staged. This is
 * the MVP answer to hard problem #2 ("reliable editing"): content comparison,
 * not timestamps. Versioned edits and three-way merges are future work.
 */
export async function assertUnchanged(
  workspace: Workspace,
  edits: StagedEdit[],
): Promise<void> {
  for (const edit of edits) {
    const current = await workspace.readFile(edit.file);
    if (current !== edit.original) {
      throw new StaleEditError(
        `${edit.file} changed after the edit was staged. Nothing was written; re-run the task to refresh the proposal.`,
      );
    }
  }
}

/**
 * Apply staged edits, all or nothing at best effort:
 * 1. every file is re-checked against the staged `original` first;
 * 2. writes happen one file at a time (each write is atomic via temp+rename);
 * 3. if a later write fails, already-written files are restored in reverse.
 *
 * A process crash mid-apply is not covered — use the checkpoint (git) before
 * running destructive tasks.
 */
export async function applyEdits(
  workspace: Workspace,
  edits: StagedEdit[],
): Promise<string[]> {
  await assertUnchanged(workspace, edits);

  const applied: StagedEdit[] = [];
  try {
    for (const edit of edits) {
      await workspace.writeFile(edit.file, edit.updated);
      applied.push(edit);
    }
  } catch (error) {
    const rollbackFailures: string[] = [];
    for (const edit of [...applied].reverse()) {
      try {
        await workspace.writeFile(edit.file, edit.original);
      } catch (rollbackError) {
        const message =
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        rollbackFailures.push(`${edit.file}: ${message}`);
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    const rollbackNote =
      applied.length === 0
        ? "No files had been written yet."
        : `Rolled back ${applied.length - rollbackFailures.length}/${applied.length} already-written file(s).`;
    const failuresNote =
      rollbackFailures.length > 0
        ? ` Rollback failures: ${rollbackFailures.join("; ")}`
        : "";
    throw new Error(`Apply failed: ${message} ${rollbackNote}${failuresNote}`);
  }

  return applied.map((edit) => edit.file);
}

/**
 * Writing approved edits to disk.
 *
 * The contract (covered by test/apply.test.ts):
 *   1. nothing is written until every file has been re-checked against the
 *      content captured when its edit was staged — if any file changed in
 *      the meantime, the whole apply aborts (drift detection);
 *   2. each write is atomic (see Workspace.writeFile);
 *   3. if a later write fails, files written so far are restored in reverse.
 *
 * A process crash mid-apply is not covered: use git as the real checkpoint.
 */
import type { Workspace } from "../context/workspace.js";
import type { StagedEdit } from "./proposal.js";

export class StaleEditError extends Error {}

/** Abort when any file changed after its edit was staged. */
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
 * Apply staged edits, all-or-nothing at best effort. Returns the files
 * written. Throws StaleEditError (nothing written) when a file changed, or
 * Error (with rollback info) when a write fails mid-apply.
 */
export async function applyEdits(
  workspace: Workspace,
  edits: StagedEdit[],
): Promise<string[]> {
  await assertUnchanged(workspace, edits);

  const writtenSoFar: StagedEdit[] = [];
  try {
    for (const edit of edits) {
      await workspace.writeFile(edit.file, edit.updated);
      writtenSoFar.push(edit);
    }
  } catch (error) {
    // Something failed mid-apply: undo the files we already wrote.
    const rollbackFailures: string[] = [];
    for (const edit of [...writtenSoFar].reverse()) {
      try {
        await workspace.writeFile(edit.file, edit.original);
      } catch (rollbackError) {
        const message =
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError);
        rollbackFailures.push(`${edit.file}: ${message}`);
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    const rollbackNote =
      writtenSoFar.length === 0
        ? "No files had been written yet."
        : `Rolled back ${writtenSoFar.length - rollbackFailures.length}/${writtenSoFar.length} already-written file(s).`;
    const failuresNote =
      rollbackFailures.length > 0
        ? ` Rollback failures: ${rollbackFailures.join("; ")}`
        : "";
    throw new Error(`Apply failed: ${message} ${rollbackNote}${failuresNote}`);
  }

  return writtenSoFar.map((edit) => edit.file);
}

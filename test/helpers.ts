/** Shared test utilities: temporary workspaces and file trees. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type TempDir = { dir: string; cleanup: () => Promise<void> };

export async function makeTempDir(prefix = "mini-cursor-test-"): Promise<TempDir> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    dir,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

export async function writeFiles(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
}

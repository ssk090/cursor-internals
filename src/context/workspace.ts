import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

const MAX_READ_BYTES = 100_000;
const MAX_SEARCH_FILES = 500;

const CODE_GLOBS = "**/*.{ts,tsx,js,jsx,json}";
const IGNORED_GLOBS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/.env*",
  "**/*secret*",
];

export class WorkspaceError extends Error {}

export type SearchHit = { file: string; score: number };

/**
 * A guarded view of one repository.
 *
 * Every read/write goes through path and symlink containment checks, a size
 * limit, and a small deny-list (.env files, .git internals). The MVP never
 * creates new files and never writes through symlinks.
 */
export class Workspace {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async assertReady(): Promise<void> {
    const stat = await fs.stat(this.root).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new WorkspaceError(`Workspace root is not a directory: ${this.root}`);
    }
  }

  /** Resolve a workspace-relative path and block lexical escapes. */
  private resolveInside(file: string): string {
    const target = path.resolve(this.root, file);
    const relative = path.relative(this.root, target);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new WorkspaceError(`Path escapes the workspace: ${file}`);
    }
    return target;
  }

  /** Follow the real path and block symlink escapes. Throws if missing. */
  private async resolveExistingInside(file: string): Promise<string> {
    const target = this.resolveInside(file);
    const realRoot = await fs.realpath(this.root);
    let realTarget: string;
    try {
      realTarget = await fs.realpath(target);
    } catch {
      throw new WorkspaceError(`File not found: ${file}`);
    }
    const relative = path.relative(realRoot, realTarget);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new WorkspaceError(`Symlink escapes the workspace: ${file}`);
    }
    return realTarget;
  }

  private assertAllowed(file: string): void {
    const normalized = file.replaceAll("\\", "/");
    const segments = normalized.split("/");
    const base = (segments[segments.length - 1] ?? "").toLowerCase();
    if (base === ".env" || base.startsWith(".env.")) {
      throw new WorkspaceError(`Access to environment files is denied: ${file}`);
    }
    if (segments.includes(".git")) {
      throw new WorkspaceError(`Access to .git internals is denied: ${file}`);
    }
  }

  async listFiles(): Promise<string[]> {
    const files = await fg(CODE_GLOBS, {
      cwd: this.root,
      onlyFiles: true,
      followSymbolicLinks: false,
      ignore: IGNORED_GLOBS,
    });
    return files.sort();
  }

  async readFile(file: string): Promise<string> {
    this.assertAllowed(file);
    const target = await this.resolveExistingInside(file);
    const stat = await fs.stat(target);
    if (!stat.isFile()) {
      throw new WorkspaceError(`Not a regular file: ${file}`);
    }
    if (stat.size > MAX_READ_BYTES) {
      throw new WorkspaceError(
        `File too large to read (${stat.size} > ${MAX_READ_BYTES} bytes): ${file}`,
      );
    }
    return fs.readFile(target, "utf8");
  }

  async writeFile(file: string, content: string): Promise<void> {
    this.assertAllowed(file);

    const target = this.resolveInside(file);
    const realRoot = await fs.realpath(this.root);

    const parentReal = await fs
      .realpath(path.dirname(target))
      .catch(() => {
        throw new WorkspaceError(`Parent directory does not exist: ${file}`);
      });
    const parentRelative = path.relative(realRoot, parentReal);
    if (
      parentRelative === ".." ||
      parentRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(parentRelative)
    ) {
      throw new WorkspaceError(`Symlink escapes the workspace: ${file}`);
    }

    const existing = await fs.lstat(target).catch(() => null);
    if (!existing) {
      throw new WorkspaceError(`Refusing to create a new file (unsupported): ${file}`);
    }
    if (existing.isSymbolicLink()) {
      throw new WorkspaceError(`Refusing to write through a symlink: ${file}`);
    }
    if (!existing.isFile()) {
      throw new WorkspaceError(`Refusing to write to a non-regular file: ${file}`);
    }

    // Write next to the target and rename over it: a crash mid-write cannot
    // leave a truncated file behind.
    const temp = `${target}.mini-cursor-${process.pid}.tmp`;
    try {
      await fs.writeFile(temp, content, "utf8");
      await fs.rename(temp, target);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }

  /**
   * Baseline lexical retrieval: filename matches weigh more than content
   * matches; every query term is scored independently. Deliberately simple —
   * this is the reference implementation that semantic retrieval is measured
   * against (see experiments/README.md, Experiment A).
   */
  async searchCode(query: string): Promise<SearchHit[]> {
    const terms = [
      ...new Set(
        query
          .toLowerCase()
          .split(/\W+/)
          .filter((term) => term.length > 1),
      ),
    ];
    if (terms.length === 0) return [];

    const files = (await this.listFiles()).slice(0, MAX_SEARCH_FILES);
    const hits: SearchHit[] = [];

    for (const file of files) {
      let content: string;
      try {
        content = (await this.readFile(file)).toLowerCase();
      } catch {
        continue; // unreadable, too large, or denied
      }
      const name = file.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (name.includes(term)) score += 5;
        if (content.includes(term)) score += 1;
      }
      if (score > 0) hits.push({ file, score });
    }

    return hits
      .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
      .slice(0, 10);
  }
}

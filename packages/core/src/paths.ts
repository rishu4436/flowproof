import path from "node:path";

/** Repo root, whether the process was started from the root or from an app package. */
export function repoRoot(): string {
  const cwd = process.cwd().replace(/\\/g, "/");
  if (/\/(apps|packages)\/[^/]+$/.test(cwd)) return path.resolve(process.cwd(), "../..");
  return process.cwd();
}

/** Artifact files always live under the repo, not under whichever package happens to be the cwd. */
export function artifactRoot(): string {
  const configured = process.env.ARTIFACT_DIR?.trim() || "data/artifacts";
  return path.isAbsolute(configured) ? configured : path.resolve(repoRoot(), configured);
}

export function isStoredInside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

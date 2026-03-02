/**
 * Version utilities for Four86.
 *
 * Consumes the build-time generated `lib/version.json`.
 * If the file doesn't exist yet (e.g. during `next dev` without a prior
 * build), every helper returns safe fallback values.
 */

export interface VersionInfo {
  version: string;
  commit: string;
  commitMessage: string;
  branch: string;
  isRelease: boolean;
  environment: string;
  buildDate: string;
  buildNumber: number;
}

// ---------------------------------------------------------------------------
// Internal loader
// ---------------------------------------------------------------------------

let cached: VersionInfo | null = null;

function load(): VersionInfo {
  if (cached) return cached;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require("./version.json") as VersionInfo;
    return cached;
  } catch {
    // version.json hasn't been generated yet — return safe defaults
    cached = {
      version: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0-dev",
      commit: "unknown",
      commitMessage: "",
      branch: "unknown",
      isRelease: false,
      environment: process.env.NODE_ENV ?? "development",
      buildDate: new Date().toISOString(),
      buildNumber: 0,
    };
    return cached;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Full version info object. */
export function getVersionInfo(): VersionInfo {
  return load();
}

/** Human-readable version string, e.g. "v0.1.0 (a1b2c3d4)". */
export function getVersionString(): string {
  const { version, commit } = load();
  return `v${version} (${commit})`;
}

/** True when the current commit is on a release tag AND env is production. */
export function isProductionBuild(): boolean {
  const { isRelease, environment } = load();
  return isRelease && environment === "production";
}

/** Safe subset suitable for API responses — no commit message or internals. */
export function getVersionForAPI(): Pick<
  VersionInfo,
  "version" | "commit" | "branch" | "environment" | "buildDate"
> {
  const { version, commit, branch, environment, buildDate } = load();
  return { version, commit, branch, environment, buildDate };
}

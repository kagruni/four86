#!/usr/bin/env node

/**
 * Build-time version generator for Four86.
 *
 * Reads the version from package.json, gathers Git metadata, and writes
 * lib/version.json (gitignored — never committed).
 *
 * Runs automatically via the "prebuild" npm script or manually with:
 *   bun run version:generate
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function git(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function buildVersionInfo() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")
  );

  const commit = git("git rev-parse --short HEAD");
  const commitMessage = git("git log -1 --pretty=%s");
  const branch = git("git rev-parse --abbrev-ref HEAD");

  // Check if the current commit sits exactly on a tag
  const tagOnHead = git("git describe --tags --exact-match HEAD 2>/dev/null");
  const isRelease = tagOnHead !== "";

  return {
    version: pkg.version,
    commit,
    commitMessage,
    branch,
    isRelease,
    environment: process.env.NODE_ENV || "development",
    buildDate: new Date().toISOString(),
    buildNumber: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Write to lib/version.json
// ---------------------------------------------------------------------------
const info = buildVersionInfo();
const outDir = path.join(ROOT, "lib");
const outFile = path.join(outDir, "version.json");

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

fs.writeFileSync(outFile, JSON.stringify(info, null, 2) + "\n");

console.log(`✓ version.json generated — v${info.version} (${info.commit})`);

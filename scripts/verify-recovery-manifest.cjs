#!/usr/bin/env node

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

const REQUIRED_COMPONENTS = new Set([
  "mongodb",
  "redis",
  "object-storage",
  "queues",
  "configuration",
  "audit-evidence",
]);

function fail(message) {
  console.error(`Recovery manifest invalid: ${message}`);
  process.exitCode = 1;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`cannot read ${manifestPath}: ${error.message}`);
    return null;
  }
}

function verify(manifestPath) {
  const manifest = readManifest(manifestPath);
  if (!manifest) return false;

  const requiredFields = ["version", "backupId", "createdAt", "rpoMinutes", "rtoMinutes", "artifacts"];
  const missing = requiredFields.filter((field) => manifest[field] === undefined);
  if (missing.length) {
    fail(`missing required field(s): ${missing.join(", ")}`);
    return false;
  }
  if (manifest.version !== 1) {
    fail("unsupported manifest version");
    return false;
  }
  if (!Number.isInteger(manifest.rpoMinutes) || manifest.rpoMinutes <= 0) {
    fail("rpoMinutes must be a positive integer");
    return false;
  }
  if (!Number.isInteger(manifest.rtoMinutes) || manifest.rtoMinutes <= 0) {
    fail("rtoMinutes must be a positive integer");
    return false;
  }
  if (!manifest.encryption?.atRest || !manifest.encryption?.keyReference) {
    fail("encrypted-at-rest backups must include a non-secret keyReference");
    return false;
  }
  if (!manifest.retention?.daily || !manifest.retention?.weekly || !manifest.retention?.monthly) {
    fail("daily, weekly, and monthly retention must be declared");
    return false;
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    fail("artifacts must be a non-empty array");
    return false;
  }

  const components = new Set(manifest.artifacts.map((artifact) => artifact.component));
  const absent = [...REQUIRED_COMPONENTS].filter((component) => !components.has(component));
  if (absent.length) {
    fail(`missing required component(s): ${absent.join(", ")}`);
    return false;
  }

  const root = path.dirname(path.resolve(manifestPath));
  for (const artifact of manifest.artifacts) {
    if (!artifact.component || !artifact.path || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
      fail(`artifact for ${artifact.component || "unknown"} needs path and sha256`);
      return false;
    }
    const filePath = path.resolve(root, artifact.path);
    if (!filePath.startsWith(`${root}${path.sep}`)) {
      fail(`artifact path escapes manifest directory: ${artifact.path}`);
      return false;
    }
    if (!fs.existsSync(filePath)) {
      fail(`artifact is missing: ${artifact.path}`);
      return false;
    }
    const actual = sha256(filePath);
    if (actual.toLowerCase() !== artifact.sha256.toLowerCase()) {
      fail(`checksum mismatch for ${artifact.component}`);
      return false;
    }
  }

  console.log(`Recovery manifest verified: ${manifest.backupId} (${manifest.artifacts.length} artifacts)`);
  return true;
}

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("Usage: node scripts/verify-recovery-manifest.cjs <manifest.json>");
  process.exit(2);
}

if (!verify(manifestPath)) process.exitCode = 1;

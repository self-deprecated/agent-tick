#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const MOBILE_DIR = resolve(SCRIPT_DIR, "..");
const AGENT_TICK_DIR = resolve(MOBILE_DIR, "../..");
const BRAND_DIR = resolve(AGENT_TICK_DIR, "../brand");
const ASSETS_DIR = resolve(MOBILE_DIR, "assets");
const APP_JSON_PATH = resolve(MOBILE_DIR, "app.json");

const BRAND_ASSET_PAIRS = [
  {
    mobile: "assets/icon.png",
    brand: "marks/exports/agent-tick-app-icon-1024.png",
  },
  {
    mobile: "assets/adaptive-icon.png",
    brand: "marks/exports/agent-tick-adaptive-icon-1024.png",
  },
  {
    mobile: "assets/notification-icon.png",
    brand: "marks/exports/agent-tick-notification-icon-96.png",
  },
];

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function findSymlinks(path) {
  if (!existsSync(path)) return [];
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return [path];
  if (!stat.isDirectory()) return [];

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isSymbolicLink()) return [child];
    if (entry.isDirectory()) return findSymlinks(child);
    return [];
  });
}

function collectExpoAssetReferences() {
  const appJson = JSON.parse(readFileSync(APP_JSON_PATH, "utf8"));
  const expo = appJson.expo ?? {};
  return [
    expo.icon,
    expo.web?.favicon,
    expo.notification?.icon,
    expo.android?.adaptiveIcon?.foregroundImage,
  ].filter((value) => typeof value === "string" && value.startsWith("./"));
}

function assertNoSymlinkedExpoAssets() {
  const symlinks = new Set(findSymlinks(ASSETS_DIR));
  if (symlinks.size > 0) {
    throw new Error(`Mobile assets must be real files, but found symlinks:\n${[...symlinks].join("\n")}`);
  }

  const symlinkedReferences = collectExpoAssetReferences()
    .map((relativePath) => resolve(MOBILE_DIR, relativePath))
    .filter((path) => existsSync(path) && lstatSync(path).isSymbolicLink());

  if (symlinkedReferences.length > 0) {
    throw new Error(`Expo config references symlinked assets:\n${symlinkedReferences.join("\n")}`);
  }
}

function assertBrandAssetsMatch() {
  if (!existsSync(BRAND_DIR)) {
    console.log(`Brand Project not found at ${BRAND_DIR}; skipping brand hash comparison.`);
    return;
  }

  const mismatches = [];
  for (const pair of BRAND_ASSET_PAIRS) {
    const mobilePath = resolve(MOBILE_DIR, pair.mobile);
    const brandPath = resolve(BRAND_DIR, pair.brand);

    if (!existsSync(mobilePath)) {
      mismatches.push(`${pair.mobile} is missing`);
      continue;
    }
    if (!existsSync(brandPath)) {
      mismatches.push(`${pair.brand} is missing`);
      continue;
    }

    const mobileHash = sha256(mobilePath);
    const brandHash = sha256(brandPath);
    if (mobileHash !== brandHash) {
      mismatches.push(`${pair.mobile} differs from ${pair.brand}`);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`Mobile brand assets are out of sync:\n${mismatches.join("\n")}`);
  }
}

export function verifyBrandAssets() {
  assertNoSymlinkedExpoAssets();
  assertBrandAssetsMatch();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    verifyBrandAssets();
    console.log("Mobile brand assets verified.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

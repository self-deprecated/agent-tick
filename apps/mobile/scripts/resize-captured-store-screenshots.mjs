#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mobileDir = resolve(scriptDir, '..');
const workspaceDir = resolve(mobileDir, '../..');
const screenshotsDir = join(mobileDir, 'store-assets', 'screenshots');
const capturesDir = join(screenshotsDir, 'captures');
const outputRoot = join(screenshotsDir, 'generated', 'captured');

const targets = {
  'apple-65': { label: 'Apple 6.5 inch', width: 1242, height: 2688 },
  'apple-67': { label: 'Apple 6.7 inch', width: 1290, height: 2796 },
  'apple-61': { label: 'Apple 6.1 inch', width: 1170, height: 2532 },
  'apple-55': { label: 'Apple 5.5 inch', width: 1242, height: 2208 },
  'google-phone': { label: 'Google Play phone', width: 1080, height: 1920 }
};

const usage = () => `Usage:
  node scripts/resize-captured-store-screenshots.mjs [--source <capture-dir>] [--size <id>] [--all]

Defaults:
  --source newest directory under store-assets/screenshots/captures
  --size apple-65

Known size ids:
${Object.entries(targets).map(([id, target]) => `  ${id.padEnd(12)} ${target.width}x${target.height} ${target.label}`).join('\n')}
`;

function parseArgs(argv) {
  const parsed = { source: null, sizes: ['apple-65'] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--source') {
      parsed.source = argv[++i];
      if (!parsed.source) throw new Error('--source requires a directory');
      continue;
    }
    if (arg === '--size') {
      const size = argv[++i];
      if (!targets[size]) throw new Error(`Unknown --size ${size}`);
      parsed.sizes = [size];
      continue;
    }
    if (arg === '--all') {
      parsed.sizes = Object.keys(targets);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function newestCaptureDir() {
  if (!existsSync(capturesDir)) throw new Error(`No captures directory exists: ${capturesDir}`);
  const dirs = readdirSync(capturesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(capturesDir, entry.name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs || b.localeCompare(a));
  if (dirs.length === 0) throw new Error(`No capture directories found under ${capturesDir}`);
  return dirs[0];
}

function imageFiles(sourceDir) {
  return readdirSync(sourceDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(png|jpe?g)$/i.test(entry.name))
    .map(entry => join(sourceDir, entry.name))
    .sort((a, b) => basename(a).localeCompare(b, undefined, { numeric: true }));
}

const magick = spawnSync('magick', ['-version'], { encoding: 'utf8' });
if (magick.status !== 0) {
  throw new Error('ImageMagick is required. Install/provide the `magick` command and retry.');
}

const args = parseArgs(process.argv.slice(2));
function resolveSourceDir(source) {
  if (isAbsolute(source)) return source;
  for (const base of [process.cwd(), mobileDir, workspaceDir]) {
    const candidate = resolve(base, source);
    if (existsSync(candidate)) return candidate;
  }
  return resolve(process.cwd(), source);
}

const sourceDir = args.source ? resolveSourceDir(args.source) : newestCaptureDir();

if (!existsSync(sourceDir)) throw new Error(`Source directory does not exist: ${sourceDir}`);
const files = imageFiles(sourceDir);
if (files.length === 0) throw new Error(`No PNG/JPEG screenshots found in ${sourceDir}`);

const sourceName = basename(sourceDir);
const manifest = {
  generatedAt: new Date().toISOString(),
  source: sourceDir,
  files: []
};

for (const sizeId of args.sizes) {
  const target = targets[sizeId];
  const outputDir = join(outputRoot, sourceName, `${sizeId}-${target.width}x${target.height}`);
  mkdirSync(outputDir, { recursive: true });

  for (const file of files) {
    const outputName = basename(file).replace(/\.(png|jpe?g)$/i, `-${sizeId}-${target.width}x${target.height}.png`);
    const outputPath = join(outputDir, outputName);
    const result = spawnSync('magick', [
      file,
      '-auto-orient',
      '-resize', `${target.width}x${target.height}^`,
      '-gravity', 'center',
      '-extent', `${target.width}x${target.height}`,
      '-strip',
      outputPath
    ], { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`magick failed for ${file}: ${result.stderr || result.stdout}`);
    }
    manifest.files.push({
      source: file,
      output: outputPath,
      size: sizeId,
      label: target.label,
      width: target.width,
      height: target.height
    });
  }
}

const manifestPath = join(outputRoot, sourceName, 'manifest.json');
mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Resized ${files.length} source screenshot(s) to ${args.sizes.join(', ')}.`);
console.log(`Source: ${sourceDir}`);
console.log(`Output: ${join(outputRoot, sourceName)}`);

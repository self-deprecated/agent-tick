#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const update = process.argv.includes('--update');

const mobileRoots = ['apps/mobile'];
const adminRoots = ['apps/admin/src'];
const ignoredPathParts = new Set(['node_modules', '__mocks__', 'dist']);
const ignoredFilePattern = /(?:^|[./])(test|spec)\.[mc]?[jt]sx?$/;
const visibleAttributeNames = new Set([
  'accessibilityLabel',
  'label',
  'placeholder',
  'title',
  'alt',
  'aria-label'
]);
const visibleObjectPropertyNames = new Set([
  'appAccess',
  'body',
  'buttonTitle',
  'hostedAccess',
  'label',
  'message',
  'paywall',
  'placeholder',
  'subtitle',
  'summary',
  'text',
  'title'
]);
const visibleCallNames = new Set([
  'translateSource',
  'tr'
]);
const ignoredObjectPropertyNames = new Set([
  'area',
  'eventType',
  'kind',
  'name',
  'role',
  'source',
  'status',
  'type'
]);
const ignoredStringValues = new Set([
  'Agent Tick',
  'agenttick.sh',
  'CLI',
  'E2EE',
  'GitHub',
  'Google',
  'Apple',
  '★',
  '...',
  '…'
]);

function walk(dir, extensions) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (entry.isDirectory()) {
      if (!ignoredPathParts.has(entry.name)) results.push(...walk(full, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext)) && !ignoredFilePattern.test(rel)) {
      results.push(full);
    }
  }
  return results;
}

function normalizeText(value) {
  return value
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCandidate(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (ignoredStringValues.has(text)) return false;
  if (text.length < 2) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (/^(https?:|agent-tick\.|agent_tick_|__agent_tick_|[a-z0-9_.-]+\/[a-z0-9_.-]+$)/i.test(text)) return false;
  if (/^[a-z0-9_.:-]+$/.test(text) && !/\s/.test(text)) return false;
  return true;
}

function keyName(name) {
  if (!name) return '';
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return '';
}

function literalText(node, source) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.getText(source).replace(/`/g, '');
  return undefined;
}

function hasJsxAncestor(node) {
  let current = node.parent;
  while (current) {
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isJsxFragment(current)) return true;
    current = current.parent;
  }
  return false;
}

function nearestCallName(node) {
  let current = node.parent;
  while (current) {
    if (ts.isCallExpression(current)) return current.expression.getText();
    current = current.parent;
  }
  return '';
}

function add(candidates, file, value) {
  const text = normalizeText(value);
  if (isCandidate(text)) candidates.set(text, file);
}

function extractTsx(file) {
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const candidates = new Map();

  function visit(node) {
    if (ts.isJsxText(node)) add(candidates, file, node.getFullText(source));

    if (ts.isJsxAttribute(node) && node.initializer && visibleAttributeNames.has(node.name.text)) {
      if (ts.isStringLiteral(node.initializer)) add(candidates, file, node.initializer.text);
      if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        const value = literalText(node.initializer.expression, source);
        if (value) add(candidates, file, value);
      }
    }

    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const value = literalText(node, source);
      if (value) {
        const call = nearestCallName(node);
        if (hasJsxAncestor(node) || call === 'Alert.alert' || visibleCallNames.has(call)) add(candidates, file, value);
      }
    }

    if (ts.isPropertyAssignment(node)) {
      const name = keyName(node.name);
      if (visibleObjectPropertyNames.has(name) && !ignoredObjectPropertyNames.has(name)) {
        const value = literalText(node.initializer, source);
        if (value) add(candidates, file, value);
      }
    }

    ts.forEachChild(node, visit);
  }
  visit(source);
  return candidates;
}

function stripSvelteExpressions(value) {
  return value.replace(/\{#?[/:@!]?[^}]+\}/g, ' ');
}

function extractSvelte(file) {
  const text = fs.readFileSync(file, 'utf8');
  const candidates = new Map();
  const markup = text.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  for (const match of markup.matchAll(/>([^<>]+)</g)) add(candidates, file, stripSvelteExpressions(match[1]));
  for (const match of markup.matchAll(/(?:aria-label|placeholder|title|alt)="([^"]+)"/g)) add(candidates, file, stripSvelteExpressions(match[1]));
  return candidates;
}

function extractPoMsgids(file) {
  if (!fs.existsSync(file)) return new Set();
  const text = fs.readFileSync(file, 'utf8');
  const ids = new Set();
  for (const match of text.matchAll(/^msgid "((?:[^"\\]|\\.)*)"$/gm)) {
    const value = match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
    if (value) ids.add(value);
  }
  return ids;
}

function collect() {
  const candidates = new Map();
  for (const dir of mobileRoots) {
    for (const file of walk(path.join(root, dir), ['.ts', '.tsx'])) {
      for (const [text, origin] of extractTsx(file)) candidates.set(text, origin);
    }
  }
  for (const dir of adminRoots) {
    for (const file of walk(path.join(root, dir), ['.svelte'])) {
      for (const [text, origin] of extractSvelte(file)) candidates.set(text, origin);
    }
  }
  return candidates;
}

function formatMarker(strings, header) {
  const escaped = [...strings].sort((a, b) => a.localeCompare(b)).map((value) => `  msg\`${value.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\`,`);
  return `${header}\nimport { msg } from "@lingui/core/macro";\n\nexport const i18nMessages = [\n${escaped.join('\n')}\n];\n`;
}

const candidates = collect();

if (update) {
  const mobileStrings = new Set();
  const adminStrings = new Set();
  for (const [text, origin] of candidates) {
    const rel = path.relative(root, origin);
    if (rel.startsWith('apps/mobile/')) mobileStrings.add(text);
    if (rel.startsWith('apps/admin/')) adminStrings.add(text);
  }
  fs.writeFileSync(
    path.join(root, 'apps/mobile/mobileI18nMessages.ts'),
    formatMarker(mobileStrings, '// Extraction markers generated by `corepack pnpm i18n:audit:update` for mobile visible strings.')
  );
  fs.writeFileSync(
    path.join(root, 'apps/admin/src/adminI18nMessages.ts'),
    formatMarker(adminStrings, '// Extraction markers generated by `corepack pnpm i18n:audit:update` for admin visible strings.')
  );
  console.log(`Updated i18n marker files with ${candidates.size} visible strings.`);
  process.exit(0);
}

const catalog = extractPoMsgids(path.join(root, 'packages/i18n/src/locales/en/messages.po'));
const missing = [...candidates].filter(([text]) => !catalog.has(text)).sort((a, b) => a[0].localeCompare(b[0]));
if (missing.length) {
  console.error(`Found ${missing.length} visible strings missing from Lingui extraction:`);
  for (const [text, origin] of missing) console.error(`- ${text}\n  ${path.relative(root, origin)}`);
  console.error('\nRun `corepack pnpm i18n:audit:update && corepack pnpm i18n:extract` after intentionally adding visible strings.');
  process.exit(1);
}
console.log(`i18n audit passed: ${candidates.size} visible strings are captured.`);

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const args = process.argv.slice(2);
const update = args.includes('--update');
const strictRuntime = args.includes('--strict-runtime');
const json = args.includes('--json');
const rootArgIndex = args.indexOf('--root');
const root = path.resolve(rootArgIndex >= 0 ? args[rootArgIndex + 1] : process.cwd());

const mobileRoots = ['apps/mobile'];
const adminRoots = ['apps/admin/src'];
const ignoredPathParts = new Set(['node_modules', '__mocks__', 'dist', 'build', '.svelte-kit']);
const ignoredFilePattern = /(?:^|[./])(test|spec)\.[mc]?[jt]sx?$/;
const markerFiles = new Set([
  path.normalize('apps/mobile/mobileI18nMessages.ts'),
  path.normalize('apps/admin/src/adminI18nMessages.ts')
]);

const visibleAttributeNames = new Set([
  'accessibilityHint',
  'accessibilityLabel',
  'alt',
  'aria-label',
  'label',
  'placeholder',
  'title'
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
  'Alert.alert',
  'alert',
  'confirm',
  'prompt',
  'window.alert',
  'window.confirm',
  'window.prompt'
]);
const translationCallNames = new Set([
  'i18n._',
  'msg',
  'tr',
  'translateSource'
]);
const visibleHelperFilePattern = /(?:^|\/)(AppLogic|diagnostics|mobileAuth|purchases|requests)\.ts$/;
const ignoredRuntimeFilePattern = /(?:^|\/)MarkdownText\.tsx$/;
const ignoredObjectPropertyNames = new Set([
  'area',
  'eventType',
  'href',
  'id',
  'kind',
  'key',
  'method',
  'name',
  'role',
  'source',
  'status',
  'testID',
  'type',
  'url',
  'value'
]);
const ignoredStringValues = new Set([
  'Agent Tick',
  'agenttick.sh',
  'CLI',
  'GitHub',
  'Google',
  'Apple',
  'GET',
  'POST',
  'PATCH',
  'DELETE',
  '★',
  '-',
  '—',
  '/',
  '...',
  '…'
]);

function pathExists(file) {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

function walk(dir, extensions) {
  const results = [];
  if (!pathExists(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (entry.isDirectory()) {
      if (!ignoredPathParts.has(entry.name)) results.push(...walk(full, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext)) && !ignoredFilePattern.test(rel) && !markerFiles.has(path.normalize(rel))) {
      results.push(full);
    }
  }
  return results;
}

function normalizeText(value) {
  return String(value)
    .replace(/\$\{[^}]+\}/g, ' $ ')
    .replace(/\{[^}]+\}/g, ' $ ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCandidate(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (ignoredStringValues.has(text)) return false;
  if (text.length < 2) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return false;
  if (/^\[[a-z_ -]+\]$/i.test(text)) return false;
  if (/redacted/i.test(text)) return false;
  if (/^(https?:|mailto:|agent-tick\.|agent_tick_|__agent_tick_|[a-z0-9_.-]+\/[a-z0-9_.-]+$)/i.test(text)) return false;
  if (/^[a-z0-9_.:-]+$/.test(text) && !/\s/.test(text)) return false;
  if (/^[A-Z0-9_:-]+$/.test(text) && !/\s/.test(text)) return false;
  if (/^[a-z]+(?:Id|ID|Name)$/i.test(text)) return false;
  return true;
}

function keyName(name) {
  if (!name) return '';
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return '';
}

function literalText(node, source) {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.getText(source).replace(/`/g, '');
  return undefined;
}

function callName(call) {
  return call.expression.getText().replace(/\s+/g, '');
}

function nearestCallName(node) {
  let current = node.parent;
  while (current) {
    if (ts.isCallExpression(current)) return callName(current);
    current = current.parent;
  }
  return '';
}

function isUnderTranslatedCall(node) {
  let current = node.parent;
  while (current) {
    if (ts.isCallExpression(current) && translationCallNames.has(callName(current))) return true;
    current = current.parent;
  }
  return false;
}

function isUnderJsxTrans(node) {
  let current = node.parent;
  while (current) {
    if (ts.isJsxElement(current)) {
      const tag = current.openingElement.tagName.getText();
      if (tag === 'Trans' || tag.endsWith('.Trans')) return true;
    }
    current = current.parent;
  }
  return false;
}

function hasJsxAncestor(node) {
  let current = node.parent;
  while (current) {
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isJsxFragment(current)) return true;
    current = current.parent;
  }
  return false;
}

function isTypePosition(node) {
  let current = node.parent;
  while (current) {
    if (
      ts.isTypeNode(current) ||
      ts.isTypeAliasDeclaration(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isImportDeclaration(current) ||
      ts.isExportDeclaration(current)
    ) return true;
    current = current.parent;
  }
  return false;
}

function isDiagnosticsOnly(node) {
  let current = node.parent;
  while (current) {
    if (ts.isPropertyAssignment(current)) {
      const name = keyName(current.name);
      if (ignoredObjectPropertyNames.has(name)) return true;
    }
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current)) return true;
    current = current.parent;
  }
  return false;
}

function enclosingVariableName(node) {
  let current = node.parent;
  while (current) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
    if (ts.isPropertyAssignment(current)) return keyName(current.name);
    current = current.parent;
  }
  return '';
}

function likelyVisibleVariable(name) {
  return /(body|copy|description|error|heading|hint|label|message|prompt|subtitle|summary|text|title)$/i.test(name);
}

function createCollector() {
  const candidates = new Map();
  const untranslated = new Map();

  function addCandidate(file, value) {
    const text = normalizeText(value);
    if (isCandidate(text) && !candidates.has(text)) candidates.set(text, file);
  }

  function addUntranslated(file, value, reason) {
    const text = normalizeText(value);
    if (!isCandidate(text)) return;
    addCandidate(file, text);
    const key = `${text}\0${file}`;
    if (!untranslated.has(key)) untranslated.set(key, { text, file, reason });
  }

  return { candidates, untranslated, addCandidate, addUntranslated };
}

function addExpressionStrings(expression, source, file, collector, reason) {
  function visit(node) {
    const value = literalText(node, source);
    if (value && !isUnderTranslatedCall(node) && !isDiagnosticsOnly(node) && !isTypePosition(node)) {
      collector.addUntranslated(file, value, reason);
    }
    ts.forEachChild(node, visit);
  }
  if (expression) visit(expression);
}

function addVisibleReturnExpression(expression, source, file, collector, reason) {
  if (!expression) return;
  if (ts.isStringLiteralLike(expression) || ts.isNoSubstitutionTemplateLiteral(expression) || ts.isTemplateExpression(expression)) {
    addExpressionStrings(expression, source, file, collector, reason);
    return;
  }
  if (ts.isConditionalExpression(expression)) {
    addVisibleReturnExpression(expression.whenTrue, source, file, collector, reason);
    addVisibleReturnExpression(expression.whenFalse, source, file, collector, reason);
    return;
  }
  if (ts.isParenthesizedExpression(expression)) {
    addVisibleReturnExpression(expression.expression, source, file, collector, reason);
    return;
  }
  if (ts.isBinaryExpression(expression)) {
    addVisibleReturnExpression(expression.left, source, file, collector, reason);
    addVisibleReturnExpression(expression.right, source, file, collector, reason);
  }
}

function extractTsLike(file, sourceText, scriptOffset = 0) {
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const collector = createCollector();
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const helperFile = visibleHelperFilePattern.test(rel);
  if (ignoredRuntimeFilePattern.test(rel)) return collector;

  function addTranslatedCallArguments(node) {
    if (!translationCallNames.has(callName(node))) return;
    const first = node.arguments[0];
    const value = literalText(first, source);
    if (value) collector.addCandidate(file, value);
  }

  function visit(node) {
    if (isUnderTranslatedCall(node)) {
      if (ts.isCallExpression(node)) addTranslatedCallArguments(node);
      ts.forEachChild(node, visit);
      return;
    }

    if (ts.isCallExpression(node)) {
      addTranslatedCallArguments(node);
      const name = callName(node);
      if (visibleCallNames.has(name)) {
        for (const argument of node.arguments) addExpressionStrings(argument, source, file, collector, `visible ${name} text`);
      }
    }

    if (ts.isJsxText(node) && !isUnderJsxTrans(node)) collector.addUntranslated(file, node.getFullText(source), 'raw JSX text');

    if (ts.isJsxAttribute(node) && node.initializer && visibleAttributeNames.has(node.name.text) && !isUnderJsxTrans(node)) {
      if (ts.isStringLiteral(node.initializer)) collector.addUntranslated(file, node.initializer.text, `raw JSX ${node.name.text}`);
      if (ts.isJsxExpression(node.initializer) && node.initializer.expression) addExpressionStrings(node.initializer.expression, source, file, collector, `raw JSX ${node.name.text}`);
    }

    if ((ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && !isTypePosition(node) && !isDiagnosticsOnly(node)) {
      const value = literalText(node, source);
      const call = nearestCallName(node);
      if (value && translationCallNames.has(call)) collector.addCandidate(file, value);
      const visibleCall = visibleCallNames.has(call);
      if (value && !translationCallNames.has(call) && (hasJsxAncestor(node) || visibleCall)) {
        collector.addUntranslated(file, value, visibleCall ? `visible ${call} text` : 'raw JSX expression text');
      }
    }

    if (ts.isPropertyAssignment(node)) {
      const name = keyName(node.name);
      if (visibleObjectPropertyNames.has(name) && !ignoredObjectPropertyNames.has(name) && !isUnderTranslatedCall(node)) {
        addExpressionStrings(node.initializer, source, file, collector, `visible object property ${name}`);
      }
    }

    if (helperFile && ts.isReturnStatement(node) && node.expression && !isUnderTranslatedCall(node)) {
      addVisibleReturnExpression(node.expression, source, file, collector, 'visible helper return text');
    }

    if (helperFile && ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name) && likelyVisibleVariable(node.name.text)) {
      addExpressionStrings(node.initializer, source, file, collector, `visible helper ${node.name.text}`);
    }

    if (ts.isNewExpression(node) && node.expression.getText(source) === 'Error') {
      for (const argument of node.arguments ?? []) addExpressionStrings(argument, source, file, collector, 'user-visible error text');
    }

    ts.forEachChild(node, visit);
  }
  visit(source);
  return collector;
}

function stripSvelteBlocks(value) {
  return value.replace(/\{[#/:@!][^}]+\}/g, ' ');
}

function decodeEntities(value) {
  return value.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function addSvelteMarkupText(markup, file, collector) {
  const withoutComments = markup.replace(/<!--[\s\S]*?-->/g, '');
  for (const match of withoutComments.matchAll(/>([^<>]+)</g)) {
    if (/[{}]/.test(match[1])) continue;
    const raw = decodeEntities(stripSvelteBlocks(match[1]));
    collector.addUntranslated(file, raw, 'raw Svelte markup text');
  }
  for (const match of withoutComments.matchAll(/\b(?:aria-label|placeholder|title|alt)="([^"]+)"/g)) {
    if (/[{}]/.test(match[1])) continue;
    const raw = decodeEntities(stripSvelteBlocks(match[1]));
    collector.addUntranslated(file, raw, 'raw Svelte attribute text');
  }
}

function extractSvelte(file) {
  const text = fs.readFileSync(file, 'utf8');
  const collector = createCollector();
  let scriptIndex = 0;
  for (const match of text.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    const script = match[1];
    const scriptCollector = extractTsLike(file, script, match.index + match[0].indexOf(script));
    for (const [candidate, origin] of scriptCollector.candidates) collector.candidates.set(candidate, origin);
    for (const [key, issue] of scriptCollector.untranslated) collector.untranslated.set(`${key}:${scriptIndex}`, issue);
    scriptIndex += 1;
  }
  const markup = text.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  addSvelteMarkupText(markup, file, collector);
  return collector;
}

function extractPoMsgids(file) {
  if (!pathExists(file)) return new Set();
  const text = fs.readFileSync(file, 'utf8');
  const ids = new Set();
  for (const match of text.matchAll(/^msgid "((?:[^"\\]|\\.)*)"$/gm)) {
    const value = match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
    if (value) ids.add(value);
  }
  return ids;
}

function collect() {
  const collector = createCollector();
  for (const dir of mobileRoots) {
    for (const file of walk(path.join(root, dir), ['.ts', '.tsx'])) {
      const fileCollector = extractTsLike(file, fs.readFileSync(file, 'utf8'));
      for (const [text, origin] of fileCollector.candidates) collector.candidates.set(text, origin);
      for (const [key, issue] of fileCollector.untranslated) collector.untranslated.set(key, issue);
    }
  }
  for (const dir of adminRoots) {
    for (const file of walk(path.join(root, dir), ['.svelte'])) {
      const fileCollector = extractSvelte(file);
      for (const [text, origin] of fileCollector.candidates) collector.candidates.set(text, origin);
      for (const [key, issue] of fileCollector.untranslated) collector.untranslated.set(key, issue);
    }
  }
  return collector;
}

function formatMarker(strings, header) {
  const escaped = [...strings]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => `  msg\`${value.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\`,`);
  return `${header}\nimport { msg } from "@lingui/core/macro";\n\nexport const i18nMessages = [\n${escaped.join('\n')}\n];\n`;
}

const { candidates, untranslated } = collect();

if (update) {
  const mobileStrings = new Set();
  const adminStrings = new Set();
  for (const [text, origin] of candidates) {
    const rel = path.relative(root, origin).replace(/\\/g, '/');
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
const untranslatedList = [...untranslated.values()].sort((a, b) => a.text.localeCompare(b.text) || a.file.localeCompare(b.file));

if (json) {
  console.log(JSON.stringify({
    candidateCount: candidates.size,
    missing: missing.map(([text, origin]) => ({ text, origin: path.relative(root, origin) })),
    untranslated: untranslatedList.map((issue) => ({ ...issue, file: path.relative(root, issue.file) }))
  }, null, 2));
}

if (strictRuntime && untranslatedList.length) {
  console.error(`Found ${untranslatedList.length} user-facing strings that are rendered or returned without runtime translation:`);
  for (const issue of untranslatedList) console.error(`- ${issue.text}\n  ${path.relative(root, issue.file)} (${issue.reason})`);
  console.error('\nWrap visible strings with translateSource/tr/<Trans> or document a deliberate exclusion in the audit.');
}

if (missing.length) {
  console.error(`Found ${missing.length} visible strings missing from Lingui extraction:`);
  for (const [text, origin] of missing) console.error(`- ${text}\n  ${path.relative(root, origin)}`);
  console.error('\nRun `corepack pnpm i18n:audit:update && corepack pnpm i18n:extract` after intentionally adding visible strings.');
}

if ((strictRuntime && untranslatedList.length) || missing.length) process.exit(1);
const runtimeSuffix = strictRuntime ? ' and runtime-translated' : '';
console.log(`i18n audit passed: ${candidates.size} visible strings are captured${runtimeSuffix}.`);

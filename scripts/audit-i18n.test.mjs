#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const auditScript = path.join(repoRoot, 'scripts/audit-i18n.mjs');
const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'agent-tick-i18n-audit-'));

function write(relativePath, content) {
  const file = path.join(fixtureRoot, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

try {
  write('apps/mobile/Fixture.tsx', `
    import React from 'react';
    import { Alert, Text, View } from 'react-native';
    import { translateSource } from '@agent-tick/i18n';

    export function Fixture() {
      Alert.alert('Raw alert title', 'Raw alert body');
      return <View><Text>Raw JSX text</Text><Text>{translateSource('Translated JSX text')}</Text><Text>Marker only</Text></View>;
    }
  `);
  write('apps/mobile/requests.ts', `
    export function helper(count: number): string {
      if (count === 1) return 'Raw helper return';
      return count + ' raw helper suffix';
    }
  `);
  write('apps/mobile/notifications.ts', `
    export const notification = { title: 'Raw notification title', body: 'Raw notification body' };
  `);
  write('apps/mobile/mobileI18nMessages.ts', `
    import { msg } from '@lingui/core/macro';
    export const i18nMessages = [msg\`Marker only\`];
  `);
  write('apps/admin/src/App.svelte', `
    <script lang="ts">
      window.prompt('Raw prompt text');
    </script>
    <h1>Raw Svelte heading</h1>
    <button aria-label="Raw Svelte aria label">Click raw</button>
  `);
  write('packages/i18n/src/locales/en/messages.po', `
msgid ""
msgstr ""

msgid "Marker only"
msgstr "Marker only"

msgid "Translated JSX text"
msgstr "Translated JSX text"

msgid "Raw JSX text"
msgstr "Raw JSX text"

msgid "Raw alert title"
msgstr "Raw alert title"

msgid "Raw alert body"
msgstr "Raw alert body"

msgid "Raw helper return"
msgstr "Raw helper return"

msgid "Raw notification title"
msgstr "Raw notification title"

msgid "Raw notification body"
msgstr "Raw notification body"

msgid "Raw prompt text"
msgstr "Raw prompt text"

msgid "Raw Svelte heading"
msgstr "Raw Svelte heading"

msgid "Raw Svelte aria label"
msgstr "Raw Svelte aria label"

msgid "Click raw"
msgstr "Click raw"
`);

  const result = spawnSync(process.execPath, [auditScript, '--root', fixtureRoot, '--strict-runtime', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  const output = `${result.stdout}\n${result.stderr}`;
  for (const expected of [
    'Raw JSX text',
    'Raw alert title',
    'Raw alert body',
    'Raw helper return',
    'Raw notification title',
    'Raw notification body',
    'Raw prompt text',
    'Raw Svelte heading',
    'Raw Svelte aria label',
    'Click raw',
    'Marker only'
  ]) {
    assert.match(output, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `expected audit to report ${expected}\n${output}`);
  }
  assert.doesNotMatch(output, /Translated JSX text[\s\S]*runtime translation/, output);
  console.log('i18n audit fixture tests passed');
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

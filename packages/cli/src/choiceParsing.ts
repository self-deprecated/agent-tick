import { ChoiceFlagSchema, type ChoiceFlag } from '@self-deprecated/agent-tick-shared';

export type ChoiceInput = {
  id: string;
  label: string;
  kind: string;
  flags?: ChoiceFlag[];
  tags?: string[];
};

export function parseChoices(values: string[] | undefined, flagValues?: string[], tagValues?: string[]): ChoiceInput[] {
  const usedIds = new Set<string>();
  const choices = (values ?? []).map((value, index) => parseChoice(value, index, usedIds));
  if (choices.length && !choices.some((choice) => choice.kind === 'deny')) {
    choices.push({ id: 'cancel', label: 'Cancel / do not answer', kind: 'deny' });
  }
  applyChoiceAnnotations(choices, flagValues, tagValues);
  return choices;
}

function parseChoice(value: string, index: number, usedIds: Set<string>): ChoiceInput {
  const separator = value.indexOf('=');
  if (separator === -1) {
    const label = value.trim();
    if (!label) throw new Error('invalid choice: label cannot be empty. Use --choice "Small fix" or --choice id=Label.');
    return uniquifyChoiceId({ id: slugifyChoiceId(label) || `choice_${index + 1}`, label, kind: inferredChoiceKind(label) }, usedIds);
  }
  if (separator <= 0) throw new Error(`invalid choice: ${value}. Use a plain label, id=Label, or id:kind=Label.`);
  const idAndKind = value.slice(0, separator).trim();
  const label = value.slice(separator + 1).trim();
  if (!label) throw new Error(`invalid choice: ${value}. Choice label cannot be empty.`);
  const kindSeparator = idAndKind.indexOf(':');
  const id = (kindSeparator === -1 ? idAndKind : idAndKind.slice(0, kindSeparator)).trim();
  const kind = (kindSeparator === -1 ? inferredChoiceKind(id) : idAndKind.slice(kindSeparator + 1).trim()) || 'approve';
  if (!id) throw new Error(`invalid choice: ${value}. Choice id cannot be empty.`);
  if (usedIds.has(id)) throw new Error(`invalid choice: ${value}. Duplicate explicit choice id: ${id}.`);
  usedIds.add(id);
  return { id, label, kind };
}

function applyChoiceAnnotations(choices: ChoiceInput[], flagValues?: string[], tagValues?: string[]): void {
  const byId = new Map(choices.map((choice) => [choice.id, choice]));
  for (const value of flagValues ?? []) {
    const { choice, entry } = parseChoiceAnnotation(value, byId, 'flag');
    const parsed = ChoiceFlagSchema.safeParse(entry);
    if (!parsed.success) throw new Error(`invalid choice flag: ${entry}. Use a supported Agent Tick choice flag.`);
    const flag = parsed.data;
    choice.flags = [...new Set([...(choice.flags ?? []), flag])];
  }
  for (const value of tagValues ?? []) {
    const { choice, entry } = parseChoiceAnnotation(value, byId, 'tag');
    if (entry.length > 40) throw new Error(`invalid choice tag: ${entry}. Tags must be 40 characters or fewer.`);
    choice.tags = [...new Set([...(choice.tags ?? []), entry])].slice(0, 8);
  }
}

function parseChoiceAnnotation(value: string, byId: Map<string, ChoiceInput>, kind: 'flag' | 'tag'): { choice: ChoiceInput; entry: string } {
  const separator = value.indexOf('=');
  if (separator <= 0) throw new Error(`invalid choice ${kind}: ${value}. Use choiceId=${kind}.`);
  const id = value.slice(0, separator).trim();
  const entry = value.slice(separator + 1).trim();
  if (!entry) throw new Error(`invalid choice ${kind}: ${value}. ${kind} cannot be empty.`);
  const choice = byId.get(id);
  if (!choice) throw new Error(`invalid choice ${kind}: unknown choice id ${id}.`);
  return { choice, entry };
}

function uniquifyChoiceId(choice: ChoiceInput, usedIds: Set<string>): ChoiceInput {
  let id = choice.id;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${choice.id}_${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return { ...choice, id };
}

export function slugifyChoiceId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}

export function inferredChoiceKind(id: string): string {
  return ['cancel', 'reject', 'deny', 'denied', 'no'].includes(id.toLowerCase()) ? 'deny' : 'approve';
}

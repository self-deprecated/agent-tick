import { z } from 'zod';

export const ChoiceFlagSchema = z.enum([
  'favorite',
  'safest',
  'fastest',
  'thorough',
  'reversible',
  'experimental',
  'blocked',
  'needs_context',
  'destructive',
  'external_effect',
  'security_sensitive',
  'costly',
  'production',
  'time_sensitive',
  'audit_relevant'
]);
export type ChoiceFlag = z.infer<typeof ChoiceFlagSchema>;

export const ChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().max(2_000).optional(),
  kind: z.string().default('approve'),
  flags: z.array(ChoiceFlagSchema).max(8).optional(),
  tags: z.array(z.string().min(1).max(40)).max(8).optional()
});
export type Choice = z.infer<typeof ChoiceSchema>;

export const ChoiceListSchema = z.array(ChoiceSchema).transform((choices) => {
  const seen = new Map<string, number>();
  return choices.map((choice) => {
    const count = seen.get(choice.id) ?? 0;
    seen.set(choice.id, count + 1);
    if (count === 0) return choice;
    return { ...choice, id: `${choice.id}_${count + 1}` };
  });
});

export const QuestionOptionSchema = z.object({
  label: z.string().min(1),
  description: z.string().max(2_000).optional()
});
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;

export const QuestionSchema = z.object({
  header: z.string().optional(),
  question: z.string().min(1),
  options: z.array(QuestionOptionSchema).max(50).default([]),
  multiSelect: z.boolean().default(false)
});
export type Question = z.infer<typeof QuestionSchema>;

export const ResponsePayloadSchema = z.object({
  choiceId: z.string().optional(),
  message: z.string().optional(),
  answers: z.record(z.string(), z.array(z.string())).optional()
});
export type ResponsePayload = z.infer<typeof ResponsePayloadSchema>;

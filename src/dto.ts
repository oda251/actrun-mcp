import * as v from "valibot";

const nonEmptyString = v.pipe(v.string(), v.minLength(1));

export const CitationSchema = v.union([
  v.object({ type: v.literal("transcript"), excerpt: v.string() }),
  v.object({ type: v.literal("uri"), source: v.string(), excerpt: v.string() }),
  v.object({ type: v.literal("command"), command: v.string(), excerpt: v.string() }),
]);

export const PlainInputSchema = v.object({
  type: v.literal("plain"),
  value: nonEmptyString,
});

export const EvidencedInputSchema = v.object({
  type: v.literal("evidenced"),
  body: nonEmptyString,
  citations: v.pipe(v.array(CitationSchema), v.minLength(1)),
});

export const InputEntrySchema = v.union([PlainInputSchema, EvidencedInputSchema]);

export const RunArgsSchema = v.object({
  type: nonEmptyString,
  inputs: v.record(v.string(), InputEntrySchema),
});

export const StatusArgsSchema = v.object({
  runId: v.optional(v.string()),
});

export const RegisterTranscriptArgsSchema = v.object({
  path: nonEmptyString,
});

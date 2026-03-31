import * as v from "valibot";
import { createSelectSchema } from "drizzle-valibot";
import { tasks } from "./schema.js";

const taskSchema = createSelectSchema(tasks);
const nonEmptyString = v.pipe(v.string(), v.minLength(1));
const taskStatusSchema = v.picklist(["running", "done", "rejected"]);

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

const ChainStepSchema = v.object({
  taskId: v.string(),
  status: v.literal("running"),
  type: v.string(),
  prompt: v.string(),
});

export const TaskRefSchema = v.object({
  taskId: taskSchema.entries.id,
  title: taskSchema.entries.title,
});

export const RunArgsSchema = v.object({
  type: nonEmptyString,
  title: nonEmptyString,
  inputs: v.record(v.string(), InputEntrySchema),
  group: v.optional(v.string()),
});

export const DoneArgsSchema = v.object({
  taskId: nonEmptyString,
  output: v.record(v.string(), v.string()),
});

export const RejectArgsSchema = v.object({
  taskId: nonEmptyString,
  reason: nonEmptyString,
});

export const StatusArgsSchema = v.object({
  taskId: v.optional(v.string()),
});

export const RegisterTranscriptArgsSchema = v.object({
  path: nonEmptyString,
});

export const RunResponseSchema = v.object({
  ...TaskRefSchema.entries,
  status: v.literal("running"),
  prompt: v.string(),
});

export const DoneResponseSchema = v.object({
  ...TaskRefSchema.entries,
  status: v.literal("done"),
  output: v.record(v.string(), v.string()),
  next: v.optional(v.array(ChainStepSchema)),
});

export const RejectResponseSchema = v.object({
  ...TaskRefSchema.entries,
  status: v.literal("rejected"),
  reason: v.string(),
});

export const TaskDoneNotificationSchema = v.object({
  ...TaskRefSchema.entries,
  output: v.record(v.string(), v.string()),
});

export const TaskRejectedNotificationSchema = v.object({
  ...TaskRefSchema.entries,
  reason: v.string(),
});

export const GroupDoneNotificationSchema = v.object({
  group: v.string(),
  tasks: v.array(v.object({
    ...TaskRefSchema.entries,
    status: taskStatusSchema,
  })),
});

export type RunArgs = v.InferOutput<typeof RunArgsSchema>;
export type DoneArgs = v.InferOutput<typeof DoneArgsSchema>;
export type RejectArgs = v.InferOutput<typeof RejectArgsSchema>;
export type StatusArgs = v.InferOutput<typeof StatusArgsSchema>;
export type RunResponse = v.InferOutput<typeof RunResponseSchema>;
export type DoneResponse = v.InferOutput<typeof DoneResponseSchema>;
export type RejectResponse = v.InferOutput<typeof RejectResponseSchema>;
export type TaskDoneNotification = v.InferOutput<typeof TaskDoneNotificationSchema>;
export type TaskRejectedNotification = v.InferOutput<typeof TaskRejectedNotificationSchema>;
export type GroupDoneNotification = v.InferOutput<typeof GroupDoneNotificationSchema>;

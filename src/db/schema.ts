import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createSelectSchema, createInsertSchema } from "drizzle-valibot";

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  inputs: text("inputs", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
  status: text("status", { enum: ["running", "done", "rejected"] }).notNull().default("running"),
  output: text("output", { mode: "json" }).$type<Record<string, string>>(),
  reason: text("reason"),
  next: text("next"),
  chainParent: text("chain_parent"),
  group: text("group"),
  caller: text("caller"),
});

export const selectTaskSchema = createSelectSchema(tasks);
export const insertTaskSchema = createInsertSchema(tasks);

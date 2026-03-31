import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { ok, err, type Result } from "neverthrow";
import { tasks } from "./db/schema.js";
import type { Db } from "./db/index.js";
import type { Task, InputEntry } from "./types.js";

export class TaskStore {
  constructor(private db: Db) {}

  create(params: {
    type: string;
    title: string;
    inputs: Record<string, InputEntry>;
    next?: string;
    chainParent?: string;
    group?: string;
    caller?: string;
  }): Task {
    const id = nanoid(12);
    this.db.insert(tasks).values({
      id,
      type: params.type,
      title: params.title,
      inputs: params.inputs,
      status: "running",
      next: params.next ?? null,
      chainParent: params.chainParent ?? null,
      group: params.group ?? null,
      caller: params.caller ?? null,
    }).run();
    const task = this.get(id);
    if (!task) throw new Error(`Failed to create task ${id}`);
    return task;
  }

  get(id: string): Task | undefined {
    const row = this.db.select().from(tasks).where(eq(tasks.id, id)).get();
    return row ? toTask(row) : undefined;
  }

  complete(id: string, output: Record<string, string>): Result<Task, string> {
    return this.ensureRunning(id).map((task) => {
      this.db.update(tasks)
        .set({ status: "done", output })
        .where(eq(tasks.id, id))
        .run();
      task.status = "done";
      task.output = output;
      return task;
    });
  }

  reject(id: string, reason: string): Result<Task, string> {
    return this.ensureRunning(id).map((task) => {
      this.db.update(tasks)
        .set({ status: "rejected", reason })
        .where(eq(tasks.id, id))
        .run();
      task.status = "rejected";
      task.reason = reason;
      return task;
    });
  }

  list(): Task[] {
    return this.db.select().from(tasks).all().map(toTask);
  }

  getRunning(): Task[] {
    return this.db.select().from(tasks).where(eq(tasks.status, "running")).all().map(toTask);
  }

  getByGroup(groupId: string): Task[] {
    return this.db.select().from(tasks).where(eq(tasks.group, groupId)).all().map(toTask);
  }

  private ensureRunning(id: string): Result<Task, string> {
    const task = this.get(id);
    if (!task) return err(`Task not found: ${id}`);
    if (task.status !== "running")
      return err(`Task ${id} is not running (status: ${task.status})`);
    return ok(task);
  }
}

function toTask(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    inputs: row.inputs as Record<string, InputEntry>,
    status: row.status as Task["status"],
    output: row.output ?? undefined,
    reason: row.reason ?? undefined,
    next: row.next ?? undefined,
    chainParent: row.chainParent ?? undefined,
    group: row.group ?? undefined,
    caller: row.caller ?? undefined,
  };
}

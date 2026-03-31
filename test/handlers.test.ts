import { describe, it, expect } from "bun:test";
import { createTestStore } from "./helpers.js";
import {
  listWorkflows,
  runWorkflow,
  completeTask,
  rejectTask,
  getStatus,
} from "../src/handlers.js";
import type { Workflow } from "../src/types.js";

function makeWorkflows(): Map<string, Workflow> {
  const map = new Map<string, Workflow>();
  map.set("dev/impl", {
    type: "dev/impl",
    domain: "dev",
    name: "impl",
    frontmatter: {
      description: "Implement code",
      inputs: { what: { description: "What to implement", type: "evidenced" }, where: { description: "Target file", type: "plain" } },
      "confirm-before-run": true,
      next: "review",
      internal: false,
    },
    body: "Write the code.",
    outputs: { changes: "Changed files" },
  });
  map.set("dev/review", {
    type: "dev/review",
    domain: "dev",
    name: "review",
    frontmatter: {
      description: "Review implementation",
      inputs: { changes: { description: "Changed files", type: "evidenced" } },
      "confirm-before-run": false,
      internal: true,
    },
    body: "Review the changes.",
    outputs: {},
  });
  map.set("research/gather", {
    type: "research/gather",
    domain: "research",
    name: "gather",
    frontmatter: {
      description: "Gather information",
      inputs: { topic: { description: "Research topic", type: "evidenced" } },
      "confirm-before-run": false,
      internal: false,
    },
    body: "Research the topic.",
    outputs: {},
  });
  return map;
}

describe("listWorkflows", () => {
  it("returns only runnable workflows with summary", () => {
    const result = listWorkflows(makeWorkflows());
    expect(result).toHaveLength(2);
    const types = result.map((w) => w.type);
    expect(types).toContain("dev/impl");
    expect(types).toContain("research/gather");
    expect(types).not.toContain("dev/review");
  });

  it("includes confirm-before-run field", () => {
    const result = listWorkflows(makeWorkflows());
    const impl = result.find((w) => w.type === "dev/impl");
    expect(impl?.["confirm-before-run"]).toBe(true);
    const gather = result.find((w) => w.type === "research/gather");
    expect(gather?.["confirm-before-run"]).toBe(false);
  });

  it("returns empty array when no workflows", () => {
    const result = listWorkflows(new Map());
    expect(result).toEqual([]);
  });
});

describe("runWorkflow", () => {
  it("creates task and returns prompt", () => {
    const store = createTestStore();
    const result = runWorkflow(makeWorkflows(), store, {
      type: "dev/impl",
      title: "Add auth",
      inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"JWT" }, where: { type: "plain", value:"src/" } },
    });

    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect(data.status).toBe("running");
    expect(data.prompt).toContain("JWT");
    expect(data.task.id).toBeDefined();
  });

  it("errors on unknown workflow type", () => {
    const store = createTestStore();
    const result = runWorkflow(makeWorkflows(), store, {
      type: "unknown/type",
      title: "Test",
      inputs: {},
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("Unknown workflow type");
  });

  it("errors on internal workflow", () => {
    const store = createTestStore();
    const result = runWorkflow(makeWorkflows(), store, {
      type: "dev/review",
      title: "Test",
      inputs: { changes: { type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"file.ts" } },
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("internal");
  });

  it("errors on missing required inputs", () => {
    const store = createTestStore();
    const result = runWorkflow(makeWorkflows(), store, {
      type: "dev/impl",
      title: "Test",
      inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"something" } },
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("where");
  });

  it("errors on empty string input value", () => {
    const store = createTestStore();
    const result = runWorkflow(makeWorkflows(), store, {
      type: "dev/impl",
      title: "Test",
      inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"something" }, where: { type: "plain", value:"" } },
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("where");
  });
});

describe("completeTask", () => {
  it("completes a task without next chain", () => {
    const workflows = makeWorkflows();
    const store = createTestStore();
    const run = runWorkflow(workflows, store, {
      type: "research/gather",
      title: "Research",
      inputs: { topic: { type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"JWT" } },
    });
    const { task: { id: taskId } } = run._unsafeUnwrap();

    const result = completeTask(workflows, store, {
      taskId,
      output: { summary: "JWT is good" },
    });

    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect(data.status).toBe("done");
    expect(data.output).toEqual({ summary: "JWT is good" });
    expect(data.next).toHaveLength(0);
  });

  it("auto-starts next step on completion", () => {
    const workflows = makeWorkflows();
    const store = createTestStore();
    const run = runWorkflow(workflows, store, {
      type: "dev/impl",
      title: "Add auth",
      inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"auth" }, where: { type: "plain", value:"src/" } },
    });
    const { task: { id: taskId } } = run._unsafeUnwrap();

    const result = completeTask(workflows, store, {
      taskId,
      output: { changes: "modified src/auth.ts" },
    });

    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect(data.status).toBe("done");
    expect(data.next).toHaveLength(1);
    const next = data.next[0];
    expect(next.type).toBe("dev/review");
    expect(next.status).toBe("running");
    expect(next.prompt).toContain("modified src/auth.ts");

    // Verify next task in store
    const nextTask = store.get(next.taskId);
    expect(nextTask).toBeDefined();
    expect(nextTask?.type).toBe("dev/review");
    expect(nextTask?.chainParent).toBe(taskId);
    expect(nextTask?.inputs).toEqual({ changes: { type: "plain", value: "modified src/auth.ts" } });
  });

  it("rejects done with missing required outputs", () => {
    const workflows = makeWorkflows();
    const store = createTestStore();
    const run = runWorkflow(workflows, store, {
      type: "dev/impl",
      title: "Add auth",
      inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"auth" }, where: { type: "plain", value:"src/" } },
    });
    const { task: { id: taskId } } = run._unsafeUnwrap();

    const result = completeTask(workflows, store, {
      taskId,
      output: {},
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("Missing required outputs");
    expect(result._unsafeUnwrapErr()).toContain("changes");

    // Task should still be running
    expect(store.get(taskId)?.status).toBe("running");
  });

  it("rejects done with empty output value", () => {
    const workflows = makeWorkflows();
    const store = createTestStore();
    const run = runWorkflow(workflows, store, {
      type: "dev/impl",
      title: "Test",
      inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"auth" }, where: { type: "plain", value:"src/" } },
    });
    const { task: { id: taskId } } = run._unsafeUnwrap();

    const result = completeTask(workflows, store, {
      taskId,
      output: { changes: "" },
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("Missing required outputs");
  });

  it("does not validate outputs when no next chain", () => {
    const workflows = makeWorkflows();
    const store = createTestStore();
    const run = runWorkflow(workflows, store, {
      type: "research/gather",
      title: "Research",
      inputs: { topic: { type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"JWT" } },
    });
    const { task: { id: taskId } } = run._unsafeUnwrap();

    // Empty output is fine when there's no next chain
    const result = completeTask(workflows, store, {
      taskId,
      output: {},
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().status).toBe("done");
  });

  it("errors on already-completed task", () => {
    const workflows = makeWorkflows();
    const store = createTestStore();
    const run = runWorkflow(workflows, store, {
      type: "research/gather",
      title: "T",
      inputs: { topic: { type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"test" } },
    });
    const { task: { id: taskId } } = run._unsafeUnwrap();
    completeTask(workflows, store, { taskId, output: {} });

    const result = completeTask(workflows, store, { taskId, output: {} });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("not running");
  });

  it("errors on nonexistent task", () => {
    const workflows = makeWorkflows();
    const store = createTestStore();
    const result = completeTask(workflows, store, {
      taskId: "no-such-id",
      output: {},
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("not found");
  });
});

describe("rejectTask", () => {
  it("rejects a running task", () => {
    const store = createTestStore();
    const task = store.create({ type: "dev/impl", title: "T", inputs: {} });

    const result = rejectTask(store, {
      taskId: task.id,
      reason: "Bad spec",
    });

    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect(data.status).toBe("rejected");
    expect(data.reason).toBe("Bad spec");
  });

  it("errors on already-done task", () => {
    const store = createTestStore();
    const task = store.create({ type: "dev/impl", title: "T", inputs: {} });
    store.complete(task.id, {});

    const result = rejectTask(store, {
      taskId: task.id,
      reason: "Too late",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("not running");
  });

  it("errors on nonexistent task", () => {
    const store = createTestStore();
    const result = rejectTask(store, {
      taskId: "no-such-id",
      reason: "whatever",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("not found");
  });
});

describe("getStatus", () => {
  it("returns all tasks when no taskId", () => {
    const store = createTestStore();
    store.create({ type: "dev/impl", title: "A", inputs: {} });
    store.create({ type: "dev/impl", title: "B", inputs: {} });

    const result = getStatus(store);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(2);
  });

  it("returns empty array when no tasks", () => {
    const store = createTestStore();
    const result = getStatus(store);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it("returns specific task by id", () => {
    const store = createTestStore();
    const task = store.create({ type: "dev/impl", title: "A", inputs: {} });

    const result = getStatus(store, task.id);
    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect((data as { id: string }).id).toBe(task.id);
  });

  it("errors on unknown task id", () => {
    const store = createTestStore();
    const result = getStatus(store, "nonexistent");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("not found");
  });
});

describe("concurrent tasks", () => {
  it("handles multiple running tasks independently", () => {
    const workflows = makeWorkflows();
    const store = createTestStore();

    const run1 = runWorkflow(workflows, store, {
      type: "research/gather",
      title: "Research A",
      inputs: { topic: { type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"A" } },
    })._unsafeUnwrap();

    const run2 = runWorkflow(workflows, store, {
      type: "research/gather",
      title: "Research B",
      inputs: { topic: { type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"B" } },
    })._unsafeUnwrap();

    // Complete first, reject second
    completeTask(workflows, store, { taskId: run1.task.id, output: { result: "done A" } });
    rejectTask(store, { taskId: run2.task.id, reason: "bad topic" });

    expect(store.get(run1.task.id)?.status).toBe("done");
    expect(store.get(run2.task.id)?.status).toBe("rejected");
    expect(store.getRunning()).toHaveLength(0);
  });
});

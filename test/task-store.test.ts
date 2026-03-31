import { describe, it, expect } from "bun:test";
import { createTestStore } from "./helpers.js";

describe("TaskStore", () => {
  it("creates a task", () => {
    const store = createTestStore();
    const task = store.create({
      type: "dev/impl",
      title: "Implement auth",
      inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"JWT middleware" }, where: { type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"src/auth/" } },
    });

    expect(task.id).toBeDefined();
    expect(task.status).toBe("running");
    expect(task.type).toBe("dev/impl");
    expect(task.inputs.what).toEqual({ type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"JWT middleware" });
  });

  it("completes a task", () => {
    const store = createTestStore();
    const task = store.create({
      type: "dev/impl",
      title: "Test",
      inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"test" } },
    });

    const result = store.complete(task.id, {
      changes: "src/auth/middleware.ts",
    });
    expect(result.isOk()).toBe(true);
    const completed = result._unsafeUnwrap();
    expect(completed.status).toBe("done");
    expect(completed.output).toEqual({ changes: "src/auth/middleware.ts" });
  });

  it("rejects a task", () => {
    const store = createTestStore();
    const task = store.create({
      type: "dev/impl",
      title: "Test",
      inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"test" } },
    });

    const result = store.reject(task.id, "Missing spec");
    expect(result.isOk()).toBe(true);
    const rejected = result._unsafeUnwrap();
    expect(rejected.status).toBe("rejected");
    expect(rejected.reason).toBe("Missing spec");
  });

  it("returns error on completing non-running task", () => {
    const store = createTestStore();
    const task = store.create({
      type: "dev/impl",
      title: "Test",
      inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"test" } },
    });
    store.complete(task.id, {});

    const result = store.complete(task.id, {});
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("not running");
  });

  it("returns error on unknown task id", () => {
    const store = createTestStore();
    const result = store.complete("nonexistent", {});
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("not found");
  });

  it("returns error on rejecting unknown task id", () => {
    const store = createTestStore();
    const result = store.reject("nonexistent", "reason");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("not found");
  });

  it("returns error on rejecting already-rejected task", () => {
    const store = createTestStore();
    const task = store.create({
      type: "dev/impl",
      title: "Test",
      inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test", excerpt: "test" }], body:"test" } },
    });
    store.reject(task.id, "first");

    const result = store.reject(task.id, "second");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("not running");
  });

  it("stores then and chainParent", () => {
    const store = createTestStore();
    const task = store.create({
      type: "dev/impl",
      title: "Test",
      inputs: {},
      next: "review",
      chainParent: "parent-123",
    });

    expect(task.next).toBe("review");
    expect(task.chainParent).toBe("parent-123");
  });

  it("generates unique IDs", () => {
    const store = createTestStore();
    const a = store.create({ type: "dev/impl", title: "A", inputs: {} });
    const b = store.create({ type: "dev/impl", title: "B", inputs: {} });
    expect(a.id).not.toBe(b.id);
  });

  it("lists tasks", () => {
    const store = createTestStore();
    store.create({ type: "dev/impl", title: "A", inputs: {} });
    store.create({ type: "dev/impl", title: "B", inputs: {} });

    expect(store.list()).toHaveLength(2);
  });

  it("filters running tasks", () => {
    const store = createTestStore();
    const a = store.create({ type: "dev/impl", title: "A", inputs: {} });
    store.create({ type: "dev/impl", title: "B", inputs: {} });
    store.complete(a.id, {});

    expect(store.getRunning()).toHaveLength(1);
  });
});

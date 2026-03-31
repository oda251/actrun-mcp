import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../src/server.js";

let tmpDir: string;

function createWorkflow(domain: string, name: string, content: string) {
  const dir = join(tmpDir, domain);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), content);
}

function setupWorkflows() {
  createWorkflow(
    "dev",
    "impl",
    `---
description: Implement code
inputs:
  what: What to implement
  where: Target file
confirm-before-run: true
next: review
---

Write the code.`,
  );

  createWorkflow(
    "dev",
    "review",
    `---
description: Review implementation
internal: true
inputs:
  changes: Changed files
---

Review the changes.`,
  );
}

async function connectClient(workflowsDir: string) {
  const { server } = createServer(workflowsDir);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);

  return client;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidekick-server-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("tools list", () => {
  it("exposes five tools", async () => {
    setupWorkflows();
    const client = await connectClient(tmpDir);

    const result = await client.listTools();
    expect(result.tools).toHaveLength(6);

    const names = result.tools.map((t) => t.name);
    expect(names).toContain("workflows");
    expect(names).toContain("run");
    expect(names).toContain("done");
    expect(names).toContain("reject");
    expect(names).toContain("status");

    await client.close();
  });
});

describe("valibot validation", () => {
  it("rejects run with empty type", async () => {
    setupWorkflows();
    const client = await connectClient(tmpDir);

    const result = await client.callTool({
      name: "run",
      arguments: { type: "", title: "Test", inputs: {} },
    });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      "Invalid arguments",
    );

    await client.close();
  });

  it("rejects done with missing arguments", async () => {
    setupWorkflows();
    const client = await connectClient(tmpDir);

    const result = await client.callTool({
      name: "done",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      "Invalid arguments",
    );

    await client.close();
  });

  it("rejects reject with empty reason", async () => {
    setupWorkflows();
    const client = await connectClient(tmpDir);

    const result = await client.callTool({
      name: "reject",
      arguments: { taskId: "some-id", reason: "" },
    });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      "Invalid arguments",
    );

    await client.close();
  });
});

describe("MCP response format", () => {
  it("returns JSON text content for success", async () => {
    setupWorkflows();
    const client = await connectClient(tmpDir);

    const result = await client.callTool({
      name: "workflows",
      arguments: {},
    });

    expect(result.isError).toBeUndefined();
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(() => JSON.parse(text)).not.toThrow();

    await client.close();
  });

  it("returns isError true for business errors", async () => {
    setupWorkflows();
    const client = await connectClient(tmpDir);

    const result = await client.callTool({
      name: "run",
      arguments: { type: "unknown/type", title: "Test", inputs: {} },
    });

    expect(result.isError).toBe(true);

    await client.close();
  });
});

describe("unknown tool", () => {
  it("returns error via MCP protocol", async () => {
    setupWorkflows();
    const client = await connectClient(tmpDir);

    const result = await client.callTool({
      name: "nonexistent",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      "Unknown tool",
    );

    await client.close();
  });
});

function parseText(result: Awaited<ReturnType<typeof client.callTool>>) {
  return JSON.parse((result.content as Array<{ text: string }>)[0].text);
}

let client: Awaited<ReturnType<typeof connectClient>>;

describe("E2E happy path", () => {
  it("run → done without next chain", async () => {
    createWorkflow(
      "research",
      "gather",
      `---
description: Gather info
inputs:
  topic: Research topic
---

Research.`,
    );
    client = await connectClient(tmpDir);

    const runResult = await client.callTool({
      name: "run",
      arguments: {
        type: "research/gather",
        title: "Research JWT",
        inputs: { topic: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"JWT" } },
      },
    });
    expect(runResult.isError).toBeUndefined();
    const { taskId } = parseText(runResult);

    const doneResult = await client.callTool({
      name: "done",
      arguments: { taskId, output: { summary: "JWT is great" } },
    });
    expect(doneResult.isError).toBeUndefined();
    const doneData = parseText(doneResult);
    expect(doneData.status).toBe("done");
    expect(doneData.next).toBeUndefined();

    const statusResult = await client.callTool({
      name: "status",
      arguments: { taskId },
    });
    expect(parseText(statusResult).status).toBe("done");

    await client.close();
  });

  it("run → reject", async () => {
    setupWorkflows();
    client = await connectClient(tmpDir);

    const runResult = await client.callTool({
      name: "run",
      arguments: {
        type: "dev/impl",
        title: "Test",
        inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"feature" }, where: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"src/" } },
      },
    });
    const { taskId } = parseText(runResult);

    const rejectResult = await client.callTool({
      name: "reject",
      arguments: { taskId, reason: "Spec incomplete" },
    });
    expect(rejectResult.isError).toBeUndefined();
    expect(parseText(rejectResult).status).toBe("rejected");

    const statusResult = await client.callTool({
      name: "status",
      arguments: { taskId },
    });
    expect(parseText(statusResult).status).toBe("rejected");

    await client.close();
  });

  it("run → done with next chain auto-start", async () => {
    setupWorkflows();
    client = await connectClient(tmpDir);

    const runResult = await client.callTool({
      name: "run",
      arguments: {
        type: "dev/impl",
        title: "Add auth",
        inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"auth middleware" }, where: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"src/auth.ts" } },
      },
    });
    const { taskId } = parseText(runResult);

    const doneResult = await client.callTool({
      name: "done",
      arguments: { taskId, output: { changes: "modified src/auth.ts" } },
    });
    const doneData = parseText(doneResult);
    expect(doneData.status).toBe("done");
    expect(doneData.next).toBeDefined();
    expect(doneData.next[0].type).toBe("dev/review");
    expect(doneData.next[0].status).toBe("running");
    expect(doneData.next[0].prompt).toContain("modified src/auth.ts");

    // Complete the chained task
    const nextDone = await client.callTool({
      name: "done",
      arguments: { taskId: doneData.next[0].taskId, output: {} },
    });
    expect(parseText(nextDone).status).toBe("done");
    expect(parseText(nextDone).next).toBeUndefined();

    await client.close();
  });

  it("rejects done with missing required outputs", async () => {
    setupWorkflows();
    client = await connectClient(tmpDir);

    const runResult = await client.callTool({
      name: "run",
      arguments: {
        type: "dev/impl",
        title: "Test",
        inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"feature" }, where: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"src/" } },
      },
    });
    const { taskId } = parseText(runResult);

    const doneResult = await client.callTool({
      name: "done",
      arguments: { taskId, output: {} },
    });
    expect(doneResult.isError).toBe(true);
    expect((doneResult.content as Array<{ text: string }>)[0].text).toContain(
      "Missing required outputs",
    );

    // Task should still be running
    const statusResult = await client.callTool({
      name: "status",
      arguments: { taskId },
    });
    expect(parseText(statusResult).status).toBe("running");

    await client.close();
  });

  it("handles concurrent tasks independently", async () => {
    setupWorkflows();
    createWorkflow(
      "research",
      "gather",
      `---
description: Gather info
inputs:
  topic: Research topic
---

Research.`,
    );
    client = await connectClient(tmpDir);

    const run1 = parseText(
      await client.callTool({
        name: "run",
        arguments: { type: "dev/impl", title: "Task 1", inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"A" }, where: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"a/" } } },
      }),
    );
    const run2 = parseText(
      await client.callTool({
        name: "run",
        arguments: { type: "research/gather", title: "Task 2", inputs: { topic: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"B" } } },
      }),
    );

    // Complete task 2, reject task 1
    await client.callTool({
      name: "done",
      arguments: { taskId: run2.taskId, output: { result: "done" } },
    });
    await client.callTool({
      name: "reject",
      arguments: { taskId: run1.taskId, reason: "cancelled" },
    });

    const allStatus = parseText(
      await client.callTool({ name: "status", arguments: {} }),
    );
    expect(allStatus).toHaveLength(2);

    await client.close();
  });
});

describe("notifications", () => {
  it("sends task.done notification when chain completes (no next)", async () => {
    createWorkflow(
      "research",
      "gather",
      `---
description: Gather info
inputs:
  topic: Research topic
---

Research.`,
    );
    const notifications: unknown[] = [];
    const { server } = createServer(tmpDir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const c = new Client({ name: "test-client", version: "1.0.0" });
    c.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
      notifications.push(n.params);
    });
    await c.connect(clientTransport);

    const runResult = parseText(
      await c.callTool({
        name: "run",
        arguments: { type: "research/gather", title: "Research JWT", inputs: { topic: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"JWT" } } },
      }),
    );

    await c.callTool({
      name: "done",
      arguments: { taskId: runResult.taskId, output: { summary: "result" } },
    });

    // Wait for async notification delivery
    await new Promise((r) => setTimeout(r, 50));

    expect(notifications).toHaveLength(1);
    const n = notifications[0] as Record<string, unknown>;
    expect(n.level).toBe("info");
    expect(n.logger).toBe("actrun-mcp");
    const data = n.data as Record<string, unknown>;
    expect(data.event).toBe("task.done");
    expect(data.taskId).toBe(runResult.taskId);
    expect(data.title).toBe("Research JWT");
    expect(data.output).toEqual({ summary: "result" });

    await c.close();
  });

  it("sends task.rejected notification", async () => {
    setupWorkflows();
    const notifications: unknown[] = [];
    const { server } = createServer(tmpDir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const c = new Client({ name: "test-client", version: "1.0.0" });
    c.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
      notifications.push(n.params);
    });
    await c.connect(clientTransport);

    const runResult = parseText(
      await c.callTool({
        name: "run",
        arguments: { type: "dev/impl", title: "Auth impl", inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"auth" }, where: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"src/" } } },
      }),
    );

    await c.callTool({
      name: "reject",
      arguments: { taskId: runResult.taskId, reason: "Spec missing" },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(notifications).toHaveLength(1);
    const data = (notifications[0] as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.event).toBe("task.rejected");
    expect(data.taskId).toBe(runResult.taskId);
    expect(data.title).toBe("Auth impl");
    expect(data.reason).toBe("Spec missing");

    await c.close();
  });

  it("does not send notification when chain continues (next exists)", async () => {
    setupWorkflows();
    const notifications: unknown[] = [];
    const { server } = createServer(tmpDir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const c = new Client({ name: "test-client", version: "1.0.0" });
    c.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
      notifications.push(n.params);
    });
    await c.connect(clientTransport);

    const runResult = parseText(
      await c.callTool({
        name: "run",
        arguments: { type: "dev/impl", title: "Auth", inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"auth" }, where: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"src/" } } },
      }),
    );

    // Complete impl → review auto-starts, NO notification yet
    await c.callTool({
      name: "done",
      arguments: { taskId: runResult.taskId, output: { changes: "src/auth.ts" } },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(notifications).toHaveLength(0);

    await c.close();
  });

  it("resolves root task ID for notification on chained task completion", async () => {
    setupWorkflows();
    const notifications: unknown[] = [];
    const { server } = createServer(tmpDir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const c = new Client({ name: "test-client", version: "1.0.0" });
    c.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
      notifications.push(n.params);
    });
    await c.connect(clientTransport);

    // Run impl (root task)
    const runResult = parseText(
      await c.callTool({
        name: "run",
        arguments: { type: "dev/impl", title: "Root Task", inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"auth" }, where: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"src/" } } },
      }),
    );

    // Complete impl → review auto-starts
    const doneResult = parseText(
      await c.callTool({
        name: "done",
        arguments: { taskId: runResult.taskId, output: { changes: "src/auth.ts" } },
      }),
    );

    // Complete review (chain complete) → notification with ROOT task info
    await c.callTool({
      name: "done",
      arguments: { taskId: doneResult.next[0].taskId, output: {} },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(notifications).toHaveLength(1);
    const data = (notifications[0] as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.event).toBe("task.done");
    // Should reference the root task, not the review task
    expect(data.taskId).toBe(runResult.taskId);
    expect(data.title).toBe("Root Task");

    await c.close();
  });
});

describe("multi-step chain (A→B→C)", () => {
  it("auto-starts through 3-step chain and notifies with root", async () => {
    // plan → impl → review
    createWorkflow(
      "dev",
      "plan",
      `---
description: Plan implementation
inputs:
  goal: What to achieve
next: impl
---

Plan the work.`,
    );
    createWorkflow(
      "dev",
      "impl",
      `---
description: Implement code
internal: true
inputs:
  goal: What to achieve
  spec: Implementation spec
next: review
---

Write the code.`,
    );
    createWorkflow(
      "dev",
      "review",
      `---
description: Review implementation
internal: true
inputs:
  changes: Changed files
---

Review the changes.`,
    );

    const notifications: unknown[] = [];
    const { server } = createServer(tmpDir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const c = new Client({ name: "test-client", version: "1.0.0" });
    c.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
      notifications.push(n.params);
    });
    await c.connect(clientTransport);

    // Step 1: Run plan
    const planResult = parseText(
      await c.callTool({
        name: "run",
        arguments: { type: "dev/plan", title: "3-step chain", inputs: { goal: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"build auth" } } },
      }),
    );

    // Step 2: Complete plan → impl auto-starts (needs spec output)
    const planDone = parseText(
      await c.callTool({
        name: "done",
        arguments: { taskId: planResult.taskId, output: { spec: "use JWT" } },
      }),
    );
    expect(planDone.next).toBeDefined();
    expect(planDone.next[0].type).toBe("dev/impl");
    expect(notifications).toHaveLength(0);

    // Step 3: Complete impl → review auto-starts (needs changes output)
    const implDone = parseText(
      await c.callTool({
        name: "done",
        arguments: { taskId: planDone.next[0].taskId, output: { changes: "src/auth.ts" } },
      }),
    );
    expect(implDone.next).toBeDefined();
    expect(implDone.next[0].type).toBe("dev/review");
    expect(notifications).toHaveLength(0);

    // Step 4: Complete review → chain complete → notification
    const reviewDone = parseText(
      await c.callTool({
        name: "done",
        arguments: { taskId: implDone.next[0].taskId, output: {} },
      }),
    );
    expect(reviewDone.next).toBeUndefined();

    await new Promise((r) => setTimeout(r, 50));

    expect(notifications).toHaveLength(1);
    const data = (notifications[0] as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.event).toBe("task.done");
    // Root is the plan task
    expect(data.taskId).toBe(planResult.taskId);
    expect(data.title).toBe("3-step chain");

    // Verify all 3 tasks in store
    const allTasks = parseText(
      await c.callTool({ name: "status", arguments: {} }),
    );
    expect(allTasks).toHaveLength(3);

    await c.close();
  });
});

describe("parallel execution (group)", () => {
  it("sends group.done when all grouped tasks complete", async () => {
    setupWorkflows();
    createWorkflow(
      "research",
      "gather",
      `---
description: Gather info
inputs:
  topic: Research topic
---

Research.`,
    );

    const notifications: unknown[] = [];
    const { server } = createServer(tmpDir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const c = new Client({ name: "test-client", version: "1.0.0" });
    c.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
      notifications.push(n.params);
    });
    await c.connect(clientTransport);

    // Run two tasks in the same group
    const task1 = parseText(
      await c.callTool({
        name: "run",
        arguments: { type: "research/gather", title: "Research A", inputs: { topic: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"A" } }, group: "batch-1" },
      }),
    );
    const task2 = parseText(
      await c.callTool({
        name: "run",
        arguments: { type: "research/gather", title: "Research B", inputs: { topic: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"B" } }, group: "batch-1" },
      }),
    );

    // Complete first task — group not yet done
    await c.callTool({
      name: "done",
      arguments: { taskId: task1.taskId, output: { result: "A done" } },
    });

    await new Promise((r) => setTimeout(r, 50));
    const groupNotifications = notifications.filter(
      (n) => ((n as Record<string, unknown>).data as Record<string, unknown>).event === "group.done",
    );
    expect(groupNotifications).toHaveLength(0);

    // Complete second task — group done
    await c.callTool({
      name: "done",
      arguments: { taskId: task2.taskId, output: { result: "B done" } },
    });

    await new Promise((r) => setTimeout(r, 50));
    const groupDone = notifications.filter(
      (n) => ((n as Record<string, unknown>).data as Record<string, unknown>).event === "group.done",
    );
    expect(groupDone).toHaveLength(1);

    const data = (groupDone[0] as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.group).toBe("batch-1");
    const tasks = data.tasks as Array<{ taskId: string; status: string }>;
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.status === "done")).toBe(true);

    await c.close();
  });

  it("sends group.done when last task is rejected", async () => {
    createWorkflow(
      "research",
      "gather",
      `---
description: Gather info
inputs:
  topic: Research topic
---

Research.`,
    );

    const notifications: unknown[] = [];
    const { server } = createServer(tmpDir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const c = new Client({ name: "test-client", version: "1.0.0" });
    c.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
      notifications.push(n.params);
    });
    await c.connect(clientTransport);

    const task1 = parseText(
      await c.callTool({
        name: "run",
        arguments: { type: "research/gather", title: "Task A", inputs: { topic: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"A" } }, group: "g2" },
      }),
    );
    const task2 = parseText(
      await c.callTool({
        name: "run",
        arguments: { type: "research/gather", title: "Task B", inputs: { topic: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"B" } }, group: "g2" },
      }),
    );

    await c.callTool({
      name: "done",
      arguments: { taskId: task1.taskId, output: {} },
    });
    await c.callTool({
      name: "reject",
      arguments: { taskId: task2.taskId, reason: "bad topic" },
    });

    await new Promise((r) => setTimeout(r, 50));
    const groupDone = notifications.filter(
      (n) => ((n as Record<string, unknown>).data as Record<string, unknown>).event === "group.done",
    );
    expect(groupDone).toHaveLength(1);

    const tasks = ((groupDone[0] as Record<string, unknown>).data as Record<string, unknown>).tasks as Array<{ status: string }>;
    expect(tasks.map((t) => t.status).sort()).toEqual(["done", "rejected"]);

    await c.close();
  });

  it("does not send group.done for tasks without group", async () => {
    createWorkflow(
      "research",
      "gather",
      `---
description: Gather info
inputs:
  topic: Research topic
---

Research.`,
    );

    const notifications: unknown[] = [];
    const { server } = createServer(tmpDir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const c = new Client({ name: "test-client", version: "1.0.0" });
    c.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
      notifications.push(n.params);
    });
    await c.connect(clientTransport);

    const task = parseText(
      await c.callTool({
        name: "run",
        arguments: { type: "research/gather", title: "Solo", inputs: { topic: { type: "evidenced", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }], body:"X" } } },
      }),
    );
    await c.callTool({
      name: "done",
      arguments: { taskId: task.taskId, output: {} },
    });

    await new Promise((r) => setTimeout(r, 50));
    const groupNotifications = notifications.filter(
      (n) => ((n as Record<string, unknown>).data as Record<string, unknown>).event === "group.done",
    );
    expect(groupNotifications).toHaveLength(0);

    await c.close();
  });
});

describe("structured inputs", () => {
  it("accepts InputValue with citations", async () => {
    createWorkflow(
      "dev",
      "simple",
      `---
description: Simple task
inputs:
  what: What to do
---

Do it.`,
    );
    client = await connectClient(tmpDir);

    const result = await client.callTool({
      name: "run",
      arguments: {
        type: "dev/simple",
        title: "Structured input test",
        inputs: {
          what: {
            type: "evidenced",
            body: "Migrate auth to JWT",
            citations: [
              { type: "uri", source: "src/auth/session.ts:15-40", excerpt: "app.use(session(...))" },
              { type: "transcript", excerpt: "セッションを切りたくない" },
            ],
          },
        },
      },
    });

    expect(result.isError).toBeUndefined();
    const data = parseText(result);
    expect(data.status).toBe("running");
    expect(data.prompt).toContain("Migrate auth to JWT");
    expect(data.prompt).toContain("src/auth/session.ts:15-40");
    expect(data.prompt).toContain("セッションを切りたくない");

    await client.close();
  });

  it("rejects InputValue with empty body", async () => {
    createWorkflow(
      "dev",
      "simple",
      `---
description: Simple task
inputs:
  what: What to do
---

Do it.`,
    );
    client = await connectClient(tmpDir);

    const result = await client.callTool({
      name: "run",
      arguments: {
        type: "dev/simple",
        title: "Empty body",
        inputs: { what: { type: "evidenced", body: "", citations: [{ type: "uri", source: "test.ts", excerpt: "test" }] } },
      },
    });

    expect(result.isError).toBe(true);

    await client.close();
  });
});

describe("register-transcript", () => {
  it("registers transcript path and includes it in prompts", async () => {
    createWorkflow(
      "dev",
      "simple",
      `---
description: Simple task
inputs:
  what: What to do
---

Do it.`,
    );
    client = await connectClient(tmpDir);

    // Register transcript
    const regResult = await client.callTool({
      name: "register-transcript",
      arguments: { path: "/tmp/test-transcript.jsonl" },
    });
    expect(regResult.isError).toBeUndefined();

    // Run with transcript citation
    const runResult = await client.callTool({
      name: "run",
      arguments: {
        type: "dev/simple",
        title: "With transcript",
        inputs: {
          what: {
            type: "evidenced",
            body: "Do the thing",
            citations: [{ type: "transcript", excerpt: "ユーザーの要求" }],
          },
        },
      },
    });

    const data = parseText(runResult);
    expect(data.prompt).toContain("/tmp/test-transcript.jsonl");
    expect(data.prompt).toContain("ユーザーの要求");

    await client.close();
  });
});

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { startServer } from "../src/server.js";

let tmpDir: string;
let stopServer: (() => void) | undefined;

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

function randomPort() {
  return 44312 + Math.floor(Math.random() * 1000);
}

async function connectHttpClient(port: number) {
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
  );
  await client.connect(transport);
  return client;
}

function parseText(result: Awaited<ReturnType<Client["callTool"]>>) {
  return JSON.parse((result.content as Array<{ text: string }>)[0].text);
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidekick-http-test-"));
});

afterEach(() => {
  stopServer?.();
  stopServer = undefined;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("HTTP transport", () => {
  it("accepts MCP client connections", async () => {
    setupWorkflows();
    const port = randomPort();
    stopServer = await startServer({ workflowsDir: tmpDir, port });

    const client = await connectHttpClient(port);

    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(6);

    const result = await client.callTool({
      name: "workflows",
      arguments: {},
    });
    const data = parseText(result);
    expect(data).toHaveLength(1);
    expect(data[0].type).toBe("dev/impl");

    await client.close();
  });

  it("shares TaskStore across multiple clients", async () => {
    setupWorkflows();
    const port = randomPort();
    stopServer = await startServer({ workflowsDir: tmpDir, port });

    const client1 = await connectHttpClient(port);
    const client2 = await connectHttpClient(port);

    // Client 1 creates a task
    const runResult = await client1.callTool({
      name: "run",
      arguments: {
        type: "dev/impl",
        title: "Shared task",
        inputs: { what: { type: "evidenced", citations: [{ type: "uri", source: "test.bin", excerpt: "test" }], body:"feature" }, where: { type: "evidenced", citations: [{ type: "uri", source: "test.bin", excerpt: "test" }], body:"src/" } },
      },
    });
    const { taskId } = parseText(runResult);

    // Client 2 completes the task
    const doneResult = await client2.callTool({
      name: "done",
      arguments: { taskId, output: { changes: "done by client 2" } },
    });
    expect(parseText(doneResult).status).toBe("done");

    // Client 1 verifies
    const statusResult = await client1.callTool({
      name: "status",
      arguments: { taskId },
    });
    expect(parseText(statusResult).status).toBe("done");

    await client1.close();
    await client2.close();
  });
});

describe("HTTP routing", () => {
  it("returns 404 for non-/mcp paths", async () => {
    setupWorkflows();
    const port = randomPort();
    stopServer = await startServer({ workflowsDir: tmpDir, port });

    const res = await fetch(`http://127.0.0.1:${port}/other`);
    expect(res.status).toBe(404);
  });

  it("returns 400 for non-initialize POST without session", async () => {
    setupWorkflows();
    const port = randomPort();
    stopServer = await startServer({ workflowsDir: tmpDir, port });

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/list",
        id: 1,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    setupWorkflows();
    const port = randomPort();
    stopServer = await startServer({ workflowsDir: tmpDir, port });

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json{{{",
    });
    expect(res.status).toBe(400);
  });

  it("routes notifications to the caller, not all clients", async () => {
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
    const port = randomPort();
    stopServer = await startServer({ workflowsDir: tmpDir, port });

    // Client 1 (caller) creates task
    const notifications1: unknown[] = [];
    const client1 = new Client({ name: "caller", version: "1.0.0" });
    client1.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
      notifications1.push(n.params);
    });
    await client1.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
    );

    // Client 2 (worker) — should NOT get the notification
    const notifications2: unknown[] = [];
    const client2 = new Client({ name: "worker", version: "1.0.0" });
    client2.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
      notifications2.push(n.params);
    });
    await client2.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
    );

    // Client 1 creates a task
    const runResult = parseText(
      await client1.callTool({
        name: "run",
        arguments: { type: "research/gather", title: "Test", inputs: { topic: { type: "evidenced", citations: [{ type: "uri", source: "test.bin", excerpt: "test" }], body:"X" } } },
      }),
    );

    // Client 2 completes the task
    await client2.callTool({
      name: "done",
      arguments: { taskId: runResult.taskId, output: { result: "done" } },
    });

    await new Promise((r) => setTimeout(r, 100));

    // Only client 1 (caller) should receive the notification
    const caller1Done = notifications1.filter(
      (n) => ((n as Record<string, unknown>).data as Record<string, unknown>).event === "task.done",
    );
    expect(caller1Done).toHaveLength(1);

    const caller2Done = notifications2.filter(
      (n) => ((n as Record<string, unknown>).data as Record<string, unknown>).event === "task.done",
    );
    expect(caller2Done).toHaveLength(0);

    await client1.close();
    await client2.close();
  });

  it("returns 404 for unknown session ID", async () => {
    setupWorkflows();
    const port = randomPort();
    stopServer = await startServer({ workflowsDir: tmpDir, port });

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "mcp-session-id": "nonexistent-session",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/list",
        id: 1,
      }),
    });
    expect(res.status).toBe(404);
  });
});

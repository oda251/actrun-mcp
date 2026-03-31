import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import * as v from "valibot";
import { loadWorkflows } from "./workflow-loader.js";
import { TaskStore } from "./task-store.js";
import { createDb } from "./db/index.js";
import {
  listWorkflows,
  runWorkflow,
  completeTask,
  rejectTask,
  getStatus,
  findRootTaskId,
  getSettledGroup,
} from "./handlers.js";
import type { Workflow, Task } from "./types.js";
import { runWorkflowFile } from "./job-runner.js";
import { defaults, serverUrl, type ServerConfig } from "./config.js";
import { createDefaultVerifier, runIntentGate, type EvidenceVerifier } from "./intent-gate.js";
import {
  RunArgsSchema,
  DoneArgsSchema,
  RejectArgsSchema,
  StatusArgsSchema,
  RegisterTranscriptArgsSchema,
  type RunResponse,
  type DoneResponse,
  type RejectResponse,
  type GroupDoneNotification,
} from "./db/dto.js";

function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResponse(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

function jsonResponse(data: unknown) {
  return textResponse(JSON.stringify(data));
}

function validationError(issues: v.BaseIssue<unknown>[]) {
  return errorResponse(`Invalid arguments: ${issues.map((i) => i.message).join("; ")}`);
}

type NotifyFn = (event: string, params: Record<string, unknown>) => void;

function notifyCaller(
  notifiers: Map<string, NotifyFn>,
  callerId: string | undefined,
  event: string,
  params: Record<string, unknown>,
) {
  if (!callerId) return;
  notifiers.get(callerId)?.(event, params);
}

function notifyTaskResult(
  notifiers: Map<string, NotifyFn>,
  store: TaskStore,
  task: Task,
  event: string,
  extra: Record<string, unknown>,
) {
  const rootId = findRootTaskId(store, task.id);
  const rootTask = rootId !== task.id ? store.get(rootId) : task;
  notifyCaller(notifiers, task.caller, event, {
    taskId: rootId,
    title: (rootTask ?? task).title,
    ...extra,
  });
}

function notifyIfGroupSettled(
  notifiers: Map<string, NotifyFn>,
  store: TaskStore,
  task: Task,
) {
  const settled = getSettledGroup(store, task);
  if (!settled) return;
  const payload: GroupDoneNotification = {
    group: settled.group,
    tasks: settled.tasks.map((t) => ({ taskId: t.id, title: t.title, status: t.status })),
  };
  notifyCaller(notifiers, task.caller, "group.done", payload);
}

const TOOL_DEFINITIONS = [
  {
    name: "workflows",
    description: "Call first to discover available task types before using run. Returns each workflow's type, description, required inputs, and whether user confirmation is needed.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "run",
    description: "Delegate a task to a worker. Call when you can fill all required inputs for a workflow. Evidenced inputs must include citations — actrun-mcp verifies them before accepting. The worker is spawned automatically.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: { type: "string", description: "Workflow type from workflows tool (e.g. dev/impl)" },
        title: { type: "string", description: "Human-readable task title. Should be specific enough for the worker to understand the goal." },
        inputs: { type: "object", description: "Key-value map matching the workflow's required inputs. Each value is either {type:'plain', value:string} for simple values, or {type:'evidenced', body:string, citations:[...]} when the input is based on conversation or existing sources." },
        group: { type: "string", description: "Optional. Group ID for batching parallel tasks." },
      },
      required: ["type", "title", "inputs"],
    },
  },
  {
    name: "done",
    description: "Report task completion. Call when the assigned work is finished. If the workflow defines outputs, they must be included.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "Task ID received in the task prompt" },
        output: { type: "object", description: "Key-value output. Must include all keys listed in the task's Outputs section." },
      },
      required: ["taskId", "output"],
    },
  },
  {
    name: "reject",
    description: "Reject a task and return it to the caller. Call when inputs are insufficient or the task cannot be completed. Do not start work — reject immediately.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "Task ID received in the task prompt" },
        reason: { type: "string", description: "Why the task cannot proceed. Be specific so the caller can fix the inputs." },
      },
      required: ["taskId", "reason"],
    },
  },
  {
    name: "status",
    description: "Check task progress. Call to monitor running tasks or verify completion.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "Specific task ID to check. Omit to get all tasks." },
      },
    },
  },
  {
    name: "register-transcript",
    description: "Register the conversation transcript path. Called automatically by the SessionStart hook — typically not called manually.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute path to the session's JSONL transcript file" },
      },
      required: ["path"],
    },
  },
];


interface McpContext {
  workflows: Map<string, Workflow>;
  store: TaskStore;
  callerId: string;
  notifiers: Map<string, NotifyFn>;
  transcriptStore: { path?: string };
  verifyEvidence?: EvidenceVerifier;
  cwd: string;
}

function configureMcpServer(server: Server, ctx: McpContext) {
  const { workflows, store, callerId, notifiers, transcriptStore, verifyEvidence, cwd } = ctx;
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "workflows":
        return jsonResponse(listWorkflows(workflows));

      case "run": {
        const parsed = v.safeParse(RunArgsSchema, args);
        if (!parsed.success) return validationError(parsed.issues);

        if (verifyEvidence) {
          const gate = await runIntentGate(parsed.output.inputs, verifyEvidence, transcriptStore.path);
          if (gate.isErr()) return errorResponse(gate.error);
        }

        return runWorkflow(workflows, store, { ...parsed.output, caller: callerId, transcriptPath: transcriptStore.path }).match(
          (data) => {
            const workflowPath = `.claude/workflows/${data.task.type}.yml`;
            runWorkflowFile(workflowPath, cwd);
            const dto: RunResponse = {
              taskId: data.task.id, title: data.task.title,
              status: data.status, prompt: data.prompt,
            };
            return jsonResponse(dto);
          },
          (e) => errorResponse(e),
        );
      }

      case "done": {
        const parsed = v.safeParse(DoneArgsSchema, args);
        if (!parsed.success) return validationError(parsed.issues);
        return completeTask(workflows, store, parsed.output, transcriptStore.path).match(
          (data) => {
            if (data.next.length === 0) notifyTaskResult(notifiers, store, data.task, "task.done", { output: data.output });
            notifyIfGroupSettled(notifiers, store, data.task);
            const dto: DoneResponse = {
              taskId: data.task.id, title: data.task.title,
              status: data.status, output: data.output,
              next: data.next.length > 0 ? data.next : undefined,
            };
            return jsonResponse(dto);
          },
          (e) => errorResponse(e),
        );
      }

      case "reject": {
        const parsed = v.safeParse(RejectArgsSchema, args);
        if (!parsed.success) return validationError(parsed.issues);
        return rejectTask(store, parsed.output).match(
          (data) => {
            notifyTaskResult(notifiers, store, data.task, "task.rejected", { reason: data.reason });
            notifyIfGroupSettled(notifiers, store, data.task);
            const dto: RejectResponse = {
              taskId: data.task.id, title: data.task.title,
              status: data.status, reason: data.reason,
            };
            return jsonResponse(dto);
          },
          (e) => errorResponse(e),
        );
      }

      case "status": {
        const parsed = v.safeParse(StatusArgsSchema, args);
        if (!parsed.success) return validationError(parsed.issues);
        return getStatus(store, parsed.output.taskId).match(
          (data) => jsonResponse(data),
          (e) => errorResponse(e),
        );
      }

      case "register-transcript": {
        const parsed = v.safeParse(RegisterTranscriptArgsSchema, args);
        if (!parsed.success) return validationError(parsed.issues);
        transcriptStore.path = parsed.output.path;
        return textResponse(`Transcript registered: ${parsed.output.path}`);
      }

      default:
        return errorResponse(`Unknown tool: ${name}`);
    }
  });
}

function newMcpServer() {
  return new Server(
    { name: "actrun-mcp", version: "0.1.0" },
    { capabilities: { tools: {}, logging: {} } },
  );
}

function createServerCore(workflowsDir: string) {
  const { workflows, errors } = loadWorkflows(workflowsDir);
  for (const e of errors) {
    console.error(`[actrun-mcp] workflow error: ${e.file}: ${e.message}`);
  }
  return { workflows, store: new TaskStore(createDb()) };
}


export function createServer(workflowsDir: string) {
  const { workflows, store } = createServerCore(workflowsDir);
  const server = newMcpServer();
  const notifiers = new Map<string, NotifyFn>();
  const callerId = "default";

  notifiers.set(callerId, (event, params) => {
    server
      .sendLoggingMessage({ level: "info", logger: "actrun-mcp", data: { event, ...params } })
      .catch(() => {});
  });

  const transcriptStore: { path?: string } = {};
  configureMcpServer(server, { workflows, store, callerId, notifiers, transcriptStore, cwd: process.cwd() });
  return { server, store, workflows };
}

export async function startServer(config: Pick<ServerConfig, "workflowsDir" | "port"> & Partial<ServerConfig>) {
  const fullConfig: ServerConfig = {
    hostname: defaults.hostname,
    cwd: process.cwd(),
    ...config,
  };
  const { workflows, store } = createServerCore(fullConfig.workflowsDir);
  const notifiers = new Map<string, NotifyFn>();
  const transcriptStore: { path?: string } = {};
  const verifyEvidence = createDefaultVerifier();
  const sessions = new Map<
    string,
    { transport: WebStandardStreamableHTTPServerTransport; server: Server }
  >();

  function createSession(): WebStandardStreamableHTTPServerTransport {
    const callerId = crypto.randomUUID();
    const server = newMcpServer();

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => callerId,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, { transport, server });
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
        notifiers.delete(transport.sessionId);
      }
    };

    notifiers.set(callerId, (event, params) => {
      server
        .sendLoggingMessage({ level: "info", logger: "actrun-mcp", data: { event, ...params } })
        .catch(() => {});
    });

    configureMcpServer(server, { workflows, store, callerId, notifiers, transcriptStore, verifyEvidence, cwd: fullConfig.cwd });
    server.connect(transport);

    return transport;
  }

  const httpServer = Bun.serve({
    port: fullConfig.port,
    hostname: fullConfig.hostname,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== defaults.mcpPath) {
        return new Response("Not Found", { status: 404 });
      }

      const sessionId = req.headers.get("mcp-session-id");
      const existing = sessionId ? sessions.get(sessionId) : undefined;

      if (existing) {
        return existing.transport.handleRequest(req);
      }

      if (sessionId) {
        return new Response("Session not found", { status: 404 });
      }

      if (req.method === "POST") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        if (isInitializeRequest(body)) {
          const transport = createSession();
          return transport.handleRequest(req, { parsedBody: body });
        }
      }

      return new Response("Bad Request", { status: 400 });
    },
  });

  console.log(`[actrun-mcp] listening on ${serverUrl(fullConfig)}`);

  return function stop() {
    for (const { transport } of sessions.values()) {
      transport.close();
    }
    httpServer.stop();
  };
}

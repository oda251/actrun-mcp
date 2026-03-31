import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import * as v from "valibot";
import { loadWorkflows } from "./workflow-loader.js";
import { runWorkflowFile } from "./job-runner.js";
import { runActrunCommand } from "./actrun-cli.js";
import { createDefaultVerifier, runIntentGate, type EvidenceVerifier } from "./intent-gate.js";
import { defaults, serverUrl, type ServerConfig } from "./config.js";
import type { Workflow } from "./types.js";
import {
  RunArgsSchema,
  StatusArgsSchema,
  RegisterTranscriptArgsSchema,
} from "./dto.js";

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

const TOOL_DEFINITIONS = [
  {
    name: "workflows",
    description: "Call first to discover available workflows before using run. Returns each workflow's type, description, required inputs, and whether user confirmation is needed.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "run",
    description: "Execute a workflow via actrun. Call when you can fill all required inputs. Evidenced inputs must include citations — verified before execution starts.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: { type: "string", description: "Workflow type from workflows tool (e.g. dev/implement)" },
        inputs: { type: "object", description: "Key-value map matching the workflow's required inputs. Each value is either {type:'plain', value:string} or {type:'evidenced', body:string, citations:[...]}." },
      },
      required: ["type", "inputs"],
    },
  },
  {
    name: "status",
    description: "Check workflow execution status. Returns job/step level details from actrun's run store.",
    inputSchema: {
      type: "object" as const,
      properties: {
        runId: { type: "string", description: "Run ID from a previous run call. Omit to list recent runs." },
      },
    },
  },
  {
    name: "logs",
    description: "Get execution logs for a workflow run.",
    inputSchema: {
      type: "object" as const,
      properties: {
        runId: { type: "string", description: "Run ID to get logs for" },
        failedOnly: { type: "boolean", description: "Only show failed task logs" },
      },
      required: ["runId"],
    },
  },
  {
    name: "register-transcript",
    description: "Register the conversation transcript path. Called automatically by the SessionStart hook.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute path to the session's JSONL transcript file" },
      },
      required: ["path"],
    },
  },
];

const LogsArgsSchema = v.object({
  runId: v.pipe(v.string(), v.minLength(1)),
  failedOnly: v.optional(v.boolean()),
});

interface McpContext {
  workflows: Map<string, Workflow>;
  transcriptStore: { path?: string };
  verifyEvidence?: EvidenceVerifier;
  cwd: string;
}

function configureMcpServer(server: Server, ctx: McpContext) {
  const { workflows, transcriptStore, verifyEvidence, cwd } = ctx;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "workflows": {
        const list = [...workflows.values()]
          .filter((w) => !w.frontmatter.internal)
          .map((w) => ({
            type: w.type,
            description: w.frontmatter.description,
            inputs: w.frontmatter.inputs,
            "confirm-before-run": w.frontmatter["confirm-before-run"],
          }));
        return jsonResponse(list);
      }

      case "run": {
        const parsed = v.safeParse(RunArgsSchema, args);
        if (!parsed.success) return validationError(parsed.issues);

        const workflow = workflows.get(parsed.output.type);
        if (!workflow) return errorResponse(`Unknown workflow: ${parsed.output.type}`);

        if (verifyEvidence) {
          const gate = await runIntentGate(parsed.output.inputs, verifyEvidence, transcriptStore.path);
          if (gate.isErr()) return errorResponse(gate.error);
        }

        const workflowPath = `.claude/workflows/${parsed.output.type}.yml`;
        const result = runWorkflowFile(workflowPath, cwd);

        return result.match(
          (r) => jsonResponse({ status: "completed", ...r }),
          (e) => errorResponse(e),
        );
      }

      case "status": {
        const parsed = v.safeParse(StatusArgsSchema, args);
        if (!parsed.success) return validationError(parsed.issues);

        if (parsed.output.runId) {
          return jsonResponse(
            JSON.parse(runActrunCommand(["run", "view", parsed.output.runId, "--json"], cwd)),
          );
        }
        return jsonResponse(
          JSON.parse(runActrunCommand(["run", "list", "--json", "--limit", "10"], cwd)),
        );
      }

      case "logs": {
        const parsed = v.safeParse(LogsArgsSchema, args);
        if (!parsed.success) return validationError(parsed.issues);

        const logsArgs = ["run", "logs", parsed.output.runId, "--json"];
        if (parsed.output.failedOnly) logsArgs.push("--log-failed");
        return jsonResponse(
          JSON.parse(runActrunCommand(logsArgs, cwd)),
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

export function createServer(workflowsDir: string) {
  const { workflows, errors } = loadWorkflows(workflowsDir);
  for (const e of errors) {
    console.error(`[actrun-mcp] workflow error: ${e.file}: ${e.message}`);
  }
  const server = newMcpServer();
  const transcriptStore: { path?: string } = {};
  configureMcpServer(server, { workflows, transcriptStore, cwd: process.cwd() });
  return { server, workflows };
}

export async function startServer(config: Pick<ServerConfig, "workflowsDir" | "port"> & Partial<ServerConfig>) {
  const fullConfig: ServerConfig = {
    hostname: defaults.hostname,
    cwd: process.cwd(),
    ...config,
  };
  const { workflows, errors } = loadWorkflows(fullConfig.workflowsDir);
  for (const e of errors) {
    console.error(`[actrun-mcp] workflow error: ${e.file}: ${e.message}`);
  }
  const transcriptStore: { path?: string } = {};
  const verifyEvidence = createDefaultVerifier();
  const sessions = new Map<
    string,
    { transport: WebStandardStreamableHTTPServerTransport; server: Server }
  >();

  function createSession(): WebStandardStreamableHTTPServerTransport {
    const server = newMcpServer();

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, { transport, server });
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    configureMcpServer(server, { workflows, transcriptStore, verifyEvidence, cwd: fullConfig.cwd });
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

      if (existing) return existing.transport.handleRequest(req);
      if (sessionId) return new Response("Session not found", { status: 404 });

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

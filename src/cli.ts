#!/usr/bin/env node

import { resolvePort, resolveWorkflowsDir } from "./config.js";
import { lint } from "./workflow-loader.js";
import { startServer } from "./server.js";
import { setup } from "./setup.js";
import { exhaustive } from "./types.js";

const COMMANDS = ["serve", "lint", "setup"] as const;
type Command = (typeof COMMANDS)[number];

const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  printUsage();
} else if (!COMMANDS.includes(command as Command)) {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
} else {
  const cmd = command as Command;
  switch (cmd) {
    case "serve": {
      const stop = await startServer({
        workflowsDir: resolveWorkflowsDir(args),
        port: resolvePort(args),
      });
      process.on("SIGINT", () => { stop(); process.exit(0); });
      break;
    }
    case "lint":
      runLint(resolveWorkflowsDir(args));
      break;
    case "setup":
      setup(process.cwd());
      break;
    default:
      exhaustive(cmd);
  }
}

function runLint(dir: string) {
  const errors = lint(dir);

  if (errors.length === 0) {
    console.log("✓ All skills valid");
    process.exit(0);
  }

  for (const e of errors) {
    console.error(`✗ ${e.file}: ${e.message}`);
  }
  process.exit(1);
}

function printUsage() {
  console.log(`actrun-mcp - Agent workflow orchestrator

Commands:
  serve [--dir path] [--port N]   Start HTTP MCP server (default: 4312)
  lint [--dir path]               Validate workflow definitions
  setup                           Install hooks and agent config into current project`);
}

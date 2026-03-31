import { spawnSync } from "node:child_process";

export function runActrunCommand(args: string[], cwd: string): string {
  const result = spawnSync("actrun", args, {
    cwd,
    encoding: "utf-8",
    timeout: 30_000,
  });

  if (result.error) {
    throw new Error(`actrun command failed: ${result.error.message}`);
  }

  return result.stdout ?? "";
}

import { spawnSync } from "node:child_process";
import { ok, err, type Result } from "neverthrow";

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function runWorkflowFile(
  workflowPath: string,
  cwd: string,
): Result<RunResult, string> {
  const result = spawnSync("actrun", [workflowPath], {
    cwd,
    encoding: "utf-8",
    timeout: 600_000,
  });

  if (result.error) {
    return err(`Failed to run actrun: ${result.error.message}`);
  }

  const runResult: RunResult = {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };

  if (runResult.exitCode !== 0) {
    return err(`Workflow failed (exit ${runResult.exitCode}): ${runResult.stderr}`);
  }

  return ok(runResult);
}

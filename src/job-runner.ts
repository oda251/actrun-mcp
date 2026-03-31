import { spawnSync } from "node:child_process";
import { ok, err, type Result } from "neverthrow";

export interface JobResult {
  job: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function runJob(
  workflowPath: string,
  jobName: string,
  cwd: string,
): Result<JobResult, string> {
  const result = spawnSync("actrun", [workflowPath, "--job", jobName], {
    cwd,
    encoding: "utf-8",
    timeout: 600_000, // 10 min
  });

  if (result.error) {
    return err(`Failed to run actrun: ${result.error.message}`);
  }

  const jobResult: JobResult = {
    job: jobName,
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };

  if (jobResult.exitCode !== 0) {
    return err(`Job ${jobName} failed (exit ${jobResult.exitCode}): ${jobResult.stderr}`);
  }

  return ok(jobResult);
}

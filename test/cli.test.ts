import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI_PATH = join(import.meta.dir, "../src/cli.ts");

let tmpDir: string;

function createWorkflow(domain: string, name: string, content: string) {
  const dir = join(tmpDir, domain);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), content);
}

function run(
  args: string[],
  env: Record<string, string> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bun", CLI_PATH, ...args], {
    env: { ...process.env, ...env },
    timeout: 5000,
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidekick-cli-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("CLI port validation", () => {
  it("rejects --port with non-numeric value", () => {
    const { exitCode, stderr } = run(["serve", "--port", "abc", "--dir", tmpDir]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid port");
  });

  it("rejects --port 0", () => {
    const { exitCode, stderr } = run(["serve", "--port", "0", "--dir", tmpDir]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid port");
  });

  it("rejects --port above 65535", () => {
    const { exitCode, stderr } = run(["serve", "--port", "99999", "--dir", tmpDir]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid port");
  });

  it("rejects invalid SIDEKICK_PORT env var", () => {
    const { exitCode, stderr } = run(
      ["serve", "--dir", tmpDir],
      { SIDEKICK_PORT: "not-a-number" },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid SIDEKICK_PORT");
  });

  it("rejects SIDEKICK_PORT 0", () => {
    const { exitCode, stderr } = run(
      ["serve", "--dir", tmpDir],
      { SIDEKICK_PORT: "0" },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid SIDEKICK_PORT");
  });
});

describe("CLI unknown command", () => {
  it("exits 1 for unknown command", () => {
    const { exitCode, stderr } = run(["bogus"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown command");
  });
});

describe("CLI lint", () => {
  it("exits 0 for valid workflows", () => {
    createWorkflow(
      "dev",
      "impl",
      `---
description: Implement
inputs:
  what: What
---

Body.`,
    );

    const { exitCode, stdout } = run(["lint", "--dir", tmpDir]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("All skills valid");
  });

  it("exits 1 for invalid workflows", () => {
    createWorkflow(
      "dev",
      "bad",
      `---
inputs:
  what: What
---

Missing description.`,
    );

    const { exitCode, stderr } = run(["lint", "--dir", tmpDir]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("dev/bad");
  });
});

import { describe, it, expect } from "bun:test";
import { buildWorkerPrompt } from "../src/prompt-builder.js";
import type { Workflow } from "../src/types.js";

const citation = { type: "uri" as const, source: "test", excerpt: "test" };

describe("buildWorkerPrompt", () => {
  it("builds prompt with inputs and workflow body", () => {
    const workflow: Workflow = {
      type: "dev/impl",
      domain: "dev",
      name: "impl",
      frontmatter: {
        description: "Implement code",
        inputs: { what: { description: "What to implement", type: "evidenced" }, where: { description: "Target file", type: "plain" } },
        "confirm-before-run": true,
        next: "review",
        internal: false,
      },
      body: "Write the code following TDD.",
      outputs: { changes: "Changed files" },
    };

    const prompt = buildWorkerPrompt(
      workflow,
      { what: { type: "evidenced", body: "JWT middleware", citations: [citation] }, where: { type: "evidenced", body: "src/auth/", citations: [citation] } },
      "task-123",
    );

    expect(prompt).toContain("task-123");
    expect(prompt).toContain("JWT middleware");
    expect(prompt).toContain("src/auth/");
    expect(prompt).toContain("Write the code following TDD.");
    expect(prompt).toContain("changes");
    expect(prompt).toContain("done");
    expect(prompt).toContain("reject");
  });

  it("omits outputs section when no next chain", () => {
    const workflow: Workflow = {
      type: "dev/review",
      domain: "dev",
      name: "review",
      frontmatter: {
        description: "Review code",
        inputs: { changes: { description: "Changed files", type: "evidenced" } },
        "confirm-before-run": false,
        internal: true,
      },
      body: "Review the changes.",
      outputs: {},
    };

    const prompt = buildWorkerPrompt(
      workflow,
      { changes: { type: "evidenced", body: "src/auth/middleware.ts", citations: [citation] } },
      "task-456",
    );

    expect(prompt).not.toContain("Outputs");
    expect(prompt).toContain("src/auth/middleware.ts");
  });

  it("embeds taskId in done and reject instructions", () => {
    const workflow: Workflow = {
      type: "dev/impl",
      domain: "dev",
      name: "impl",
      frontmatter: {
        description: "Impl",
        inputs: { what: { description: "What", type: "evidenced" } },
        "confirm-before-run": false,
        internal: false,
      },
      body: "Do it.",
      outputs: {},
    };

    const prompt = buildWorkerPrompt(workflow, { what: { type: "evidenced", body: "x", citations: [citation] } }, "abc-999");

    expect(prompt).toContain("done");
    expect(prompt).toContain("reject");
    expect(prompt).toContain("abc-999");
  });

  it("formats multiple output keys in done hint", () => {
    const workflow: Workflow = {
      type: "dev/impl",
      domain: "dev",
      name: "impl",
      frontmatter: {
        description: "Impl",
        inputs: { what: { description: "What", type: "evidenced" } },
        "confirm-before-run": false,
        next: "review",
        internal: false,
      },
      body: "Do it.",
      outputs: { changes: "Changed files", summary: "Summary of changes" },
    };

    const prompt = buildWorkerPrompt(workflow, { what: { type: "evidenced", body: "x", citations: [citation] } }, "task-1");

    expect(prompt).toContain("changes");
    expect(prompt).toContain("summary");
    expect(prompt).toContain("Outputs");
  });

  it("omits output hint in done instruction when no outputs", () => {
    const workflow: Workflow = {
      type: "dev/review",
      domain: "dev",
      name: "review",
      frontmatter: {
        description: "Review",
        inputs: { changes: { description: "Changes", type: "evidenced" } },
        "confirm-before-run": false,
        internal: false,
      },
      body: "Review.",
      outputs: {},
    };

    const prompt = buildWorkerPrompt(
      workflow,
      { changes: { type: "evidenced", body: "file.ts", citations: [citation] } },
      "task-2",
    );

    expect(prompt).not.toContain("output:");
  });

  it("renders task section before workflow and protocol last", () => {
    const workflow: Workflow = {
      type: "dev/impl",
      domain: "dev",
      name: "impl",
      frontmatter: {
        description: "Impl",
        inputs: { what: { description: "What", type: "evidenced" } },
        "confirm-before-run": false,
        internal: false,
      },
      body: "Do the work.",
      outputs: {},
    };

    const prompt = buildWorkerPrompt(workflow, { what: { type: "evidenced", body: "x", citations: [citation] } }, "t-1");

    const taskIdx = prompt.indexOf("## タスク");
    const workflowIdx = prompt.indexOf("## ワークフロー");
    const protocolIdx = prompt.indexOf("## プロトコル");

    expect(taskIdx).toBeLessThan(workflowIdx);
    expect(workflowIdx).toBeLessThan(protocolIdx);
  });
});

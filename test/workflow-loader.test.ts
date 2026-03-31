import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadWorkflows,
  lint,
  getRunnableWorkflows,
} from "../src/workflow-loader.js";

let tmpDir: string;

function createWorkflow(domain: string, name: string, content: string) {
  const dir = join(tmpDir, domain);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), content);
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidekick-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadWorkflows", () => {
  it("loads a valid workflow", () => {
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

    const { workflows, errors } = loadWorkflows(tmpDir);
    expect(errors).toHaveLength(0);
    expect(workflows.size).toBe(2);

    const impl = workflows.get("dev/impl") ?? (() => { throw new Error("dev/impl not found"); })();
    expect(impl.frontmatter.description).toBe("Implement code");
    expect(impl.frontmatter.inputs).toEqual({
      what: { description: "What to implement", type: "evidenced" },
      where: { description: "Target file", type: "evidenced" },
    });
    expect(impl.frontmatter["confirm-before-run"]).toBe(true);
    expect(impl.frontmatter.next).toBe("review");
    expect(impl.body).toBe("Write the code.");
  });

  it("rejects workflow with missing description", () => {
    createWorkflow(
      "dev",
      "bad",
      `---
inputs:
  what: Something
---

Body.`,
    );

    const { workflows, errors } = loadWorkflows(tmpDir);
    expect(workflows.size).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("description");
  });

  it("rejects workflow with missing inputs", () => {
    createWorkflow(
      "dev",
      "bad",
      `---
description: Something
---

Body.`,
    );

    const { workflows, errors } = loadWorkflows(tmpDir);
    expect(workflows.size).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("inputs");
  });

  it("reports error for unresolved next reference", () => {
    createWorkflow(
      "dev",
      "impl",
      `---
description: Implement
inputs:
  what: Something
next: nonexistent
---

Body.`,
    );

    const { errors } = loadWorkflows(tmpDir);
    expect(errors.some((e) => e.message.includes("non-existent"))).toBe(true);
  });

  it("resolves outputs from next chain", () => {
    createWorkflow(
      "dev",
      "impl",
      `---
description: Implement
inputs:
  what: What to implement
next: review
---

Body.`,
    );

    createWorkflow(
      "dev",
      "review",
      `---
description: Review
internal: true
inputs:
  changes: Changed files
---

Review.`,
    );

    const { workflows } = loadWorkflows(tmpDir);
    const impl = workflows.get("dev/impl") ?? (() => { throw new Error("dev/impl not found"); })();
    expect(impl.outputs).toEqual({ changes: "Changed files" });
  });

  it("does not include shared inputs in outputs", () => {
    createWorkflow(
      "dev",
      "impl",
      `---
description: Implement
inputs:
  what: What to implement
  spec: Specification
next: review
---

Body.`,
    );

    createWorkflow(
      "dev",
      "review",
      `---
description: Review
internal: true
inputs:
  spec: Specification
  changes: Changed files
---

Review.`,
    );

    const { workflows } = loadWorkflows(tmpDir);
    const impl = workflows.get("dev/impl") ?? (() => { throw new Error("dev/impl not found"); })();
    // spec is shared, only changes should be in outputs
    expect(impl.outputs).toEqual({ changes: "Changed files" });
  });

  it("returns empty for non-existent directory", () => {
    const { workflows, errors } = loadWorkflows("/tmp/nonexistent-dir-xxx");
    expect(workflows.size).toBe(0);
    expect(errors).toHaveLength(0);
  });

  it("defaults confirm-before-run to false and internal to false", () => {
    createWorkflow(
      "dev",
      "simple",
      `---
description: Simple workflow
inputs:
  what: Something
---

Do it.`,
    );

    const { workflows } = loadWorkflows(tmpDir);
    const simple = workflows.get("dev/simple") ?? (() => { throw new Error("not found"); })();
    expect(simple.frontmatter["confirm-before-run"]).toBe(false);
    expect(simple.frontmatter.internal).toBe(false);
  });

  it("loads workflows from multiple domains", () => {
    createWorkflow("dev", "impl", `---
description: Dev impl
inputs:
  what: What
---
Body.`);

    createWorkflow("research", "gather", `---
description: Research gather
inputs:
  topic: Topic
---
Body.`);

    const { workflows, errors } = loadWorkflows(tmpDir);
    expect(errors).toHaveLength(0);
    expect(workflows.size).toBe(2);
    expect(workflows.has("dev/impl")).toBe(true);
    expect(workflows.has("research/gather")).toBe(true);
  });

  it("ignores non-.md files", () => {
    createWorkflow("dev", "impl", `---
description: Impl
inputs:
  what: What
---
Body.`);

    const dir = join(tmpDir, "dev");
    writeFileSync(join(dir, "notes.txt"), "not a workflow");

    const { workflows } = loadWorkflows(tmpDir);
    expect(workflows.size).toBe(1);
  });
});

describe("lint", () => {
  it("detects circular next chains", () => {
    createWorkflow(
      "dev",
      "a",
      `---
description: A
inputs:
  x: X
next: b
---
A.`,
    );

    createWorkflow(
      "dev",
      "b",
      `---
description: B
inputs:
  x: X
next: a
---
B.`,
    );

    const errors = lint(tmpDir);
    expect(errors.some((e) => e.message.includes("Circular"))).toBe(true);
  });

  it("detects orphaned internal workflows", () => {
    createWorkflow(
      "dev",
      "orphan",
      `---
description: Orphan
internal: true
inputs:
  x: X
---
Orphan.`,
    );

    const errors = lint(tmpDir);
    expect(errors.some((e) => e.message.includes("orphaned"))).toBe(true);
  });

  it("passes for valid workflows", () => {
    createWorkflow(
      "dev",
      "impl",
      `---
description: Implement
inputs:
  what: What
next: review
---
Impl.`,
    );

    createWorkflow(
      "dev",
      "review",
      `---
description: Review
internal: true
inputs:
  changes: Changes
---
Review.`,
    );

    const errors = lint(tmpDir);
    expect(errors).toHaveLength(0);
  });
});

describe("getRunnableWorkflows", () => {
  it("filters out internal workflows", () => {
    createWorkflow(
      "dev",
      "impl",
      `---
description: Implement
inputs:
  what: What
---
Impl.`,
    );

    createWorkflow(
      "dev",
      "review",
      `---
description: Review
internal: true
inputs:
  changes: Changes
---
Review.`,
    );

    const { workflows } = loadWorkflows(tmpDir);
    const runnable = getRunnableWorkflows(workflows);
    expect(runnable).toHaveLength(1);
    expect(runnable[0].type).toBe("dev/impl");
  });
});

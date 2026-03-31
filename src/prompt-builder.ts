import type { Workflow, InputEntry, Citation } from "./types.js";

export function buildWorkerPrompt(
  workflow: Workflow,
  inputs: Record<string, InputEntry>,
  taskId: string,
  transcriptPath?: string,
): string {
  const sections: string[] = [];

  // タスク
  const inputLines = Object.entries(inputs)
    .map(([key, entry]) => formatInput(key, entry, transcriptPath))
    .join("\n\n");

  let taskSection = `## タスク\n\nタスクID: ${taskId}\n\n### Inputs\n\n${inputLines}`;

  if (Object.keys(workflow.outputs).length > 0) {
    const outputLines = Object.entries(workflow.outputs)
      .map(([key, desc]) => `- **${key}**: ${desc}`)
      .join("\n");
    taskSection += `\n\n### Outputs（完了時に返す）\n\n${outputLines}`;
  }

  sections.push(taskSection);

  // ワークフロー
  sections.push(`## ワークフロー\n\n${workflow.body}`);

  // プロトコル
  sections.push(`## プロトコル

inputs が不十分なら作業を始めずに reject で差し戻す。
作業が完了したら done で報告する。`);

  return sections.join("\n\n");
}

function formatInput(key: string, entry: InputEntry, transcriptPath?: string): string {
  if (entry.type === "plain") {
    return `- **${key}**: ${entry.value}`;
  }

  const lines = [`- **${key}**: ${entry.body}`];
  for (const citation of entry.citations) {
    const source = resolveSource(citation, transcriptPath);
    if (citation.excerpt) {
      lines.push(`  - 出典: \`${source}\` — "${citation.excerpt}"`);
    } else {
      lines.push(`  - 出典: \`${source}\``);
    }
  }
  return lines.join("\n");
}

function resolveSource(citation: Citation, transcriptPath?: string): string {
  if (citation.type === "transcript") {
    return transcriptPath ?? "(transcript path not registered)";
  }
  return citation.source;
}


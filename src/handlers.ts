import { ok, err, type Result } from "neverthrow";
import type { Workflow, Task, InputEntry, InputSpec } from "./types.js";
import type { TaskStore } from "./task-store.js";
import { getRunnableWorkflows } from "./workflow-loader.js";
import { buildWorkerPrompt } from "./prompt-builder.js";

export interface WorkflowSummary {
  type: string;
  description: string;
  inputs: Record<string, InputSpec>;
  "confirm-before-run": boolean;
}

export interface RunResult {
  task: Task;
  status: "running";
  prompt: string;
}

export interface NextStep {
  taskId: string;
  status: "running";
  type: string;
  prompt: string;
}

export interface DoneResult {
  task: Task;
  status: "done";
  output: Record<string, string>;
  next: NextStep[];
}

export interface RejectResult {
  task: Task;
  status: "rejected";
  reason: string;
}

function toArray(val: string | string[] | undefined): string[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function inputText(entry: InputEntry): string {
  return entry.type === "plain" ? entry.value : entry.body;
}

export function listWorkflows(
  workflows: Map<string, Workflow>,
): WorkflowSummary[] {
  return getRunnableWorkflows(workflows).map((w) => ({
    type: w.type,
    description: w.frontmatter.description,
    inputs: w.frontmatter.inputs,
    "confirm-before-run": w.frontmatter["confirm-before-run"],
  }));
}

export function runWorkflow(
  workflows: Map<string, Workflow>,
  store: TaskStore,
  params: {
    type: string;
    title: string;
    inputs: Record<string, InputEntry>;
    group?: string;
    caller?: string;
    transcriptPath?: string;
  },
): Result<RunResult, string> {
  const workflow = workflows.get(params.type);
  if (!workflow) return err(`Unknown workflow type: ${params.type}`);

  if (workflow.frontmatter.internal) {
    return err(`Workflow ${params.type} is internal (not directly runnable)`);
  }

  const errors: string[] = [];
  for (const [key, spec] of Object.entries(workflow.frontmatter.inputs)) {
    if (!(key in params.inputs) || !inputText(params.inputs[key])) {
      errors.push(`missing: ${key}`);
      continue;
    }
    const entry = params.inputs[key];
    if (entry.type !== spec.type) {
      errors.push(`${key}: expected ${spec.type}, got ${entry.type}`);
    }
  }

  if (errors.length > 0) {
    return err(`Invalid inputs: ${errors.join("; ")}`);
  }

  const task = store.create({
    type: params.type,
    title: params.title,
    inputs: params.inputs,
    next: workflow.frontmatter.next,
    group: params.group,
    caller: params.caller,
  });

  const prompt = buildWorkerPrompt(workflow, params.inputs, task.id, params.transcriptPath);
  return ok({ task, status: "running" as const, prompt });
}

export function completeTask(
  workflows: Map<string, Workflow>,
  store: TaskStore,
  params: { taskId: string; output: Record<string, string> },
  transcriptPath?: string,
): Result<DoneResult, string> {
  const task = store.get(params.taskId);
  if (!task) return err(`Task not found: ${params.taskId}`);
  if (task.status !== "running")
    return err(`Task ${params.taskId} is not running (status: ${task.status})`);

  const workflow = workflows.get(task.type);
  if (!workflow) return err(`Workflow not found for task type: ${task.type}`);

  // Validate required outputs when next chain exists
  if (workflow.frontmatter.next) {
    const missing = Object.keys(workflow.outputs).filter(
      (k) => !(k in params.output) || !params.output[k],
    );
    if (missing.length > 0) {
      return err(`Missing required outputs: ${missing.join(", ")}`);
    }
  }

  return store.complete(params.taskId, params.output).map(() => {
    const nextNames = toArray(workflow.frontmatter.next);
    const next: NextStep[] = [];

    for (const nextName of nextNames) {
      const nextType = `${workflow.domain}/${nextName}`;
      const nextWorkflow = workflows.get(nextType);
      if (!nextWorkflow) continue;

      const nextInputs: Record<string, InputEntry> = {};
      for (const key of Object.keys(nextWorkflow.frontmatter.inputs)) {
        if (key in params.output) {
          nextInputs[key] = { type: "plain", value: params.output[key] };
        } else if (key in task.inputs) {
          nextInputs[key] = task.inputs[key];
        }
      }

      const nextTask = store.create({
        type: nextType,
        title: task.title,
        inputs: nextInputs,
        next: nextWorkflow.frontmatter.next,
        chainParent: params.taskId,
        caller: task.caller,
      });

      next.push({
        taskId: nextTask.id,
        status: "running",
        type: nextType,
        prompt: buildWorkerPrompt(nextWorkflow, nextInputs, nextTask.id, transcriptPath),
      });
    }

    return { task, status: "done" as const, output: params.output, next };
  });
}

export function rejectTask(
  store: TaskStore,
  params: { taskId: string; reason: string },
): Result<RejectResult, string> {
  return store
    .reject(params.taskId, params.reason)
    .map((task) => ({
      task,
      status: "rejected" as const,
      reason: params.reason,
    }));
}

export function getStatus(
  store: TaskStore,
  taskId?: string,
): Result<Task | Task[], string> {
  if (taskId) {
    const task = store.get(taskId);
    if (!task) return err(`Task not found: ${taskId}`);
    return ok(task);
  }
  return ok(store.list());
}

export function findRootTaskId(store: TaskStore, taskId: string): string {
  let current = store.get(taskId);
  while (current?.chainParent) {
    const parent = store.get(current.chainParent);
    if (!parent) break;
    current = parent;
  }
  return current?.id ?? taskId;
}

export function getSettledGroup(
  store: TaskStore,
  task: { group?: string },
): { group: string; tasks: Task[] } | undefined {
  if (!task.group) return undefined;
  const groupTasks = store.getByGroup(task.group);
  if (groupTasks.some((t) => t.status === "running")) return undefined;
  return { group: task.group, tasks: groupTasks };
}

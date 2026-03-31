export type InputType = "plain" | "evidenced";

export interface InputSpec {
  description: string;
  type: InputType;
}

export interface WorkflowFrontmatter {
  description: string;
  inputs: Record<string, InputSpec>;
  "confirm-before-run": boolean;
  next?: string | string[];
  internal: boolean;
  tools?: string[];
  "permission-mode"?: string;
}

export interface Workflow {
  type: string;
  domain: string;
  name: string;
  frontmatter: WorkflowFrontmatter;
  body: string;
  outputs: Record<string, string>;
}

export type TranscriptCitation = {
  type: "transcript";
  excerpt: string;
};

export type UriCitation = {
  type: "uri";
  source: string;
  excerpt: string;
};

export type CommandCitation = {
  type: "command";
  command: string;
  excerpt: string;
};

export type Citation = TranscriptCitation | UriCitation | CommandCitation;

export interface PlainInput {
  type: "plain";
  value: string;
}

export interface EvidencedInput {
  type: "evidenced";
  body: string;
  citations: Citation[];
}

export type InputEntry = PlainInput | EvidencedInput;

export type TaskStatus = "running" | "done" | "rejected";

export interface Task {
  id: string;
  type: string;
  title: string;
  inputs: Record<string, InputEntry>;
  status: TaskStatus;
  output?: Record<string, string>;
  reason?: string;
  next?: string | string[];
  chainParent?: string;
  group?: string;
  caller?: string;
}

export interface LintError {
  file: string;
  message: string;
}

export function exhaustive(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}

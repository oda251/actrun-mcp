import { createDb } from "../src/db/index.js";
import { TaskStore } from "../src/task-store.js";

export function createTestStore(): TaskStore {
  return new TaskStore(createDb());
}

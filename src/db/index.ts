import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as schema from "./schema.js";

export function createDb() {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA journal_mode = WAL");
  const db = drizzle(sqlite, { schema });
  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    inputs TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'running',
    output TEXT,
    reason TEXT,
    next TEXT,
    chain_parent TEXT,
    "group" TEXT,
    caller TEXT
  )`);
  return db;
}

export type Db = ReturnType<typeof createDb>;

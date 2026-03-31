import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const HOOKS_DIR = resolve(import.meta.dir, "../hooks");

const FILES = [
  { src: "register-transcript.sh", dest: ".claude/hooks/register-transcript.sh" },
  { src: "actrun-mcp.md", dest: ".claude/hooks/bootstrap/actrun-mcp.md" },
];

export function setup(projectDir: string) {
  for (const { src, dest } of FILES) {
    const srcPath = join(HOOKS_DIR, src);
    const destPath = join(projectDir, dest);
    const destDir = resolve(destPath, "..");

    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    copyFileSync(srcPath, destPath);
    console.log(`[actrun-mcp] installed ${dest}`);
  }
}

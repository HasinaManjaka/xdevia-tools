import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Returns true if a path exists (file or directory), without throwing. */
export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/** Returns true if the path exists and is a directory. */
export async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/** Returns true if the path exists and is a regular file. */
export async function isFile(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/** Resolves a user-supplied path (possibly relative, possibly using ~) against a base directory. */
export function resolveUserPath(inputPath: string, baseDir: string): string {
  const expanded = expandHome(inputPath);
  return path.isAbsolute(expanded) ? expanded : path.resolve(baseDir, expanded);
}

function expandHome(inputPath: string): string {
  if (inputPath === '~') return process.env['HOME'] ?? inputPath;
  if (inputPath.startsWith('~/')) {
    const home = process.env['HOME'];
    if (home) return path.join(home, inputPath.slice(2));
  }
  return inputPath;
}

/** Reads and JSON-parses a file, throwing a descriptive error on malformed JSON. */
export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf-8');
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new SyntaxError(
      `Failed to parse JSON in "${filePath}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** Writes an object as pretty-printed JSON, creating parent directories if needed. */
export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

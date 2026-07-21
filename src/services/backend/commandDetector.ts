import path from 'node:path';
import { promises as fs } from 'node:fs';

import type { BackendCommandInfo, XdevConfig } from '../../types/index.js';
import { BackendError } from '../../errors/index.js';
import { isFile, readJsonFile } from '../../utils/fs.js';

/** Script names checked in priority order when no explicit override is configured. */
const CANDIDATE_SCRIPT_NAMES = ['dev:server', 'dev', 'start:dev', 'server:dev', 'start'];

interface PackageJsonShape {
  scripts?: Record<string, string>;
}

/**
 * Determines the command used to start the backend in development mode.
 *
 * Priority:
 * 1. `backendCommand` explicitly set in `.xdevrc.json`.
 * 2. The first matching script found in the backend's package.json, checked
 *    in `CANDIDATE_SCRIPT_NAMES` order.
 * 3. A best-effort fallback guess (`tsx watch src/server.ts`) — used only if
 *    nothing else can be found, and clearly labeled as a guess.
 */
export async function detectBackendCommand(
  backendDir: string,
  config: XdevConfig
): Promise<BackendCommandInfo> {
  if (config.backendCommand) {
    return { command: config.backendCommand, source: 'config-override' };
  }

  const packageJsonPath = path.join(backendDir, 'package.json');
  if (!(await isFile(packageJsonPath))) {
    throw new BackendError(`No package.json found in backend directory "${backendDir}".`, {
      hint: 'Run xdev from the root of your backend project, or set "backendCommand" in .xdevrc.json.',
    });
  }

  let pkg: PackageJsonShape;
  try {
    pkg = await readJsonFile<PackageJsonShape>(packageJsonPath);
  } catch (err) {
    throw new BackendError(`Could not parse "${packageJsonPath}".`, {
      hint: 'Check the file for JSON syntax errors (trailing commas, missing quotes, etc).',
      cause: err,
    });
  }

  const scripts = pkg.scripts ?? {};
  for (const name of CANDIDATE_SCRIPT_NAMES) {
    if (scripts[name]) {
      return { command: `npm run ${name}`, scriptName: name, source: 'package-json-script' };
    }
  }

  // Last resort: look for a plausible entry file and guess a tsx/node command.
  const guess = await guessEntryCommand(backendDir);
  if (guess) {
    return { command: guess, source: 'fallback-guess' };
  }

  throw new BackendError('Could not determine how to start the backend.', {
    hint:
      `Add a "dev" or "dev:server" script to ${packageJsonPath}, ` +
      `or set "backendCommand" explicitly in .xdevrc.json.`,
  });
}

async function guessEntryCommand(backendDir: string): Promise<string | undefined> {
  const candidates = [
    { file: 'src/server.ts', command: 'tsx watch src/server.ts' },
    { file: 'src/index.ts', command: 'tsx watch src/index.ts' },
    { file: 'server.js', command: 'node server.js' },
    { file: 'index.js', command: 'node index.js' },
  ];

  for (const candidate of candidates) {
    const fullPath = path.join(backendDir, candidate.file);
    try {
      await fs.access(fullPath);
      return candidate.command;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

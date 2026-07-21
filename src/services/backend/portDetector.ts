import path from 'node:path';
import { promises as fs } from 'node:fs';
import prompts from 'prompts';

import type { BackendPortInfo, XdevConfig } from '../../types/index.js';
import { parseEnv } from '../../utils/envFile.js';
import { pathExists } from '../../utils/fs.js';
import { UserCancelledError } from '../../errors/index.js';

const DEFAULT_FALLBACK_PORT = 4000;

/**
 * Determines which port the backend will listen on, without ever hardcoding
 * a "standard" port as an assumption baked into logic — the fallback is only
 * used after every other source has been checked, and it's presented to the
 * user for confirmation rather than assumed silently.
 *
 * Priority:
 * 1. `backendPort` set explicitly in `.xdevrc.json`.
 * 2. `PORT` (or common alternates) from the backend's `.env` file.
 * 3. `PORT` from the current process environment.
 * 4. Interactive prompt, defaulting to a generic fallback the user can override.
 */
export async function detectBackendPort(
  backendDir: string,
  config: XdevConfig
): Promise<BackendPortInfo> {
  if (config.backendPort) {
    return { port: config.backendPort, source: 'config-override' };
  }

  const fromEnvFile = await readPortFromEnvFile(backendDir);
  if (fromEnvFile) {
    return { port: fromEnvFile, source: 'dotenv' };
  }

  const fromProcessEnv = readPortFromProcessEnv();
  if (fromProcessEnv) {
    return { port: fromProcessEnv, source: 'process-env' };
  }

  const port = await promptForPort();
  return { port, source: 'user-prompt' };
}

const PORT_KEYS = ['PORT', 'SERVER_PORT', 'API_PORT', 'BACKEND_PORT'];

async function readPortFromEnvFile(backendDir: string): Promise<number | undefined> {
  const envPath = path.join(backendDir, '.env');
  if (!(await pathExists(envPath))) return undefined;

  const content = await fs.readFile(envPath, 'utf-8');
  const values = parseEnv(content);
  for (const key of PORT_KEYS) {
    const raw = values[key];
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function readPortFromProcessEnv(): number | undefined {
  for (const key of PORT_KEYS) {
    const raw = process.env[key];
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

async function promptForPort(): Promise<number> {
  const response = await prompts(
    {
      type: 'number',
      name: 'port',
      message: 'Could not detect the backend port automatically. Which port does it listen on?',
      initial: DEFAULT_FALLBACK_PORT,
    },
    {
      onCancel: () => {
        throw new UserCancelledError('Cancelled while asking for the backend port.');
      },
    }
  );

  const port = response['port'] as number | undefined;
  if (!port || port <= 0) {
    throw new UserCancelledError('No valid port was provided.');
  }
  return port;
}

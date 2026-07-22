import path from 'node:path';
import { promises as fs } from 'node:fs';
import prompts from 'prompts';

import {
  CONFIG_FILE_NAME,
  CONFIG_SCHEMA_VERSION,
  DEFAULT_ENV_VARIABLE,
  type XdevConfig,
} from '../types/index.js';
import { ConfigError, FrontendPathError, UserCancelledError } from '../errors/index.js';
import { isDirectory, isFile, pathExists, readJsonFile, resolveUserPath, writeJsonFile } from '../utils/fs.js';
import { logger } from '../logger/index.js';

export interface LoadConfigOptions {
  /** Project root to look for / write the config file in. Defaults to process.cwd(). */
  cwd?: string;
  /** Force the interactive setup even if a config already exists. */
  reconfigure?: boolean;
}

/**
 * Loads the project's `.xdevrc.json`, running the first-time interactive
 * setup if it doesn't exist yet (or if `reconfigure` is requested).
 */
export async function loadOrCreateConfig(options: LoadConfigOptions = {}): Promise<XdevConfig> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = path.join(cwd, CONFIG_FILE_NAME);

  if (!options.reconfigure && (await isFile(configPath))) {
    return readConfigFile(configPath);
  }

  const config = await runInteractiveSetup(cwd);
  await writeJsonFile(configPath, config);
  logger.success(`Saved configuration to ${CONFIG_FILE_NAME}`);
  return config;
}

async function readConfigFile(configPath: string): Promise<XdevConfig> {
  let raw: Record<string, unknown>;
  try {
    raw = await readJsonFile<Record<string, unknown>>(configPath);
  } catch (err) {
    throw new ConfigError(`Could not read ${CONFIG_FILE_NAME}: malformed JSON.`, {
      hint: `Fix or delete "${configPath}" and re-run the command to regenerate it.`,
      cause: err,
    });
  }

  if (typeof raw['frontendPath'] !== 'string' || raw['frontendPath'].length === 0) {
    throw new ConfigError(`"${CONFIG_FILE_NAME}" is missing a valid "frontendPath".`, {
      hint: `Delete "${configPath}" and re-run the command, or edit the field manually.`,
    });
  }

  return {
    frontendPath: raw['frontendPath'],
    envVariable: typeof raw['envVariable'] === 'string' ? raw['envVariable'] : DEFAULT_ENV_VARIABLE,
    ngrok: typeof raw['ngrok'] === 'boolean' ? raw['ngrok'] : true,
    backendCommand: typeof raw['backendCommand'] === 'string' ? raw['backendCommand'] : undefined,
    backendPort: typeof raw['backendPort'] === 'number' ? raw['backendPort'] : undefined,
    backendPath: typeof raw['backendPath'] === 'string' ? raw['backendPath'] : undefined,
    version: typeof raw['version'] === 'number' ? raw['version'] : CONFIG_SCHEMA_VERSION,
  };
}

async function runInteractiveSetup(cwd: string): Promise<XdevConfig> {
  logger.title('First-time setup');
  logger.detail('No configuration found for this project — let\'s set it up (one time only).');

  const response = await prompts(
    {
      type: 'text',
      name: 'frontendPath',
      message: 'Where is your frontend project?',
      initial: '../frontend',
    },
    {
      onCancel: () => {
        throw new UserCancelledError('Setup cancelled — no configuration was saved.');
      },
    }
  );

  const rawFrontendPath = (response['frontendPath'] as string | undefined)?.trim();
  if (!rawFrontendPath) {
    throw new UserCancelledError('Setup cancelled — no frontend path was provided.');
  }

  const resolvedPath = resolveUserPath(rawFrontendPath, cwd);
  await validateFrontendPath(resolvedPath);

  const pathResponse = await prompts(
    {
      type: 'text',
      name: 'backendPath',
      message: 'Does your backend serve an API under a base path? (e.g. /api/v1)',
      initial: '',
    },
    {
      onCancel: () => {
        throw new UserCancelledError('Setup cancelled — no configuration was saved.');
      },
    }
  );

  const rawBackendPath = (pathResponse['backendPath'] as string | undefined)?.trim();
  const backendPath = rawBackendPath && rawBackendPath.length > 0 ? rawBackendPath : undefined;

  return {
    frontendPath: path.relative(cwd, resolvedPath) || '.',
    envVariable: DEFAULT_ENV_VARIABLE,
    ngrok: true,
    backendPath,
    version: CONFIG_SCHEMA_VERSION,
  };
}

/**
 * Validates that a frontend path looks like a real project: the directory
 * must exist and contain a package.json. A missing .env is tolerated — we
 * create one on demand later — but we report it either way.
 */
export async function validateFrontendPath(resolvedPath: string): Promise<void> {
  if (!(await isDirectory(resolvedPath))) {
    throw new FrontendPathError(`Frontend directory not found: "${resolvedPath}"`, {
      hint: 'Double-check the path and make sure it points to an existing folder.',
    });
  }

  const packageJsonPath = path.join(resolvedPath, 'package.json');
  if (!(await isFile(packageJsonPath))) {
    throw new FrontendPathError(`No package.json found in "${resolvedPath}"`, {
      hint: 'Make sure this path points to the root of your frontend project.',
    });
  }

  const envPath = path.join(resolvedPath, '.env');
  if (!(await pathExists(envPath))) {
    logger.warn(`No .env file found in "${resolvedPath}" — one will be created.`);
    await fs.writeFile(envPath, '', 'utf-8');
  }
}

/** Resolves the configured frontend path (which is stored relative to the project root) to an absolute path. */
export function resolveFrontendPath(config: XdevConfig, cwd: string): string {
  return resolveUserPath(config.frontendPath, cwd);
}

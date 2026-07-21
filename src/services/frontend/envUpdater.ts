import path from 'node:path';
import { promises as fs } from 'node:fs';

import { EnvFileError } from '../../errors/index.js';
import { pathExists } from '../../utils/fs.js';
import { setEnvVariable } from '../../utils/envFile.js';

export interface UpdateFrontendEnvOptions {
  frontendDir: string;
  variableName: string;
  value: string;
}

export interface UpdateFrontendEnvResult {
  envPath: string;
  action: 'replaced' | 'appended';
}

/**
 * Updates (or creates) the frontend's `.env` file with the given variable,
 * preserving every other line untouched.
 */
export async function updateFrontendEnv(
  options: UpdateFrontendEnvOptions
): Promise<UpdateFrontendEnvResult> {
  const envPath = path.join(options.frontendDir, '.env');

  let currentContent = '';
  if (await pathExists(envPath)) {
    try {
      currentContent = await fs.readFile(envPath, 'utf-8');
    } catch (err) {
      throw new EnvFileError(`Could not read "${envPath}".`, {
        hint: 'Check file permissions for the frontend .env file.',
        cause: err,
      });
    }
  }

  const { content, action } = setEnvVariable(currentContent, options.variableName, options.value);

  try {
    await fs.writeFile(envPath, content, 'utf-8');
  } catch (err) {
    throw new EnvFileError(`Could not write "${envPath}".`, {
      hint: 'Check that the file is not read-only and that you have write permission to the directory.',
      cause: err,
    });
  }

  return { envPath, action };
}

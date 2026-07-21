import chalk from 'chalk';

import type { DevCommandOptions, ManagedProcess } from '../types/index.js';
import { loadOrCreateConfig, resolveFrontendPath, validateFrontendPath } from '../config/configManager.js';
import { detectBackendCommand } from '../services/backend/commandDetector.js';
import { detectBackendPort } from '../services/backend/portDetector.js';
import { startManagedProcess } from '../services/backend/processRunner.js';
import { startNgrokTunnel } from '../services/ngrok/ngrokManager.js';
import { updateFrontendEnv } from '../services/frontend/envUpdater.js';
import { isPortFree } from '../utils/port.js';
import { BackendError } from '../errors/index.js';
import { logger } from '../logger/index.js';

/**
 * Runs the full `xdev dev` workflow:
 * backend -> port detection -> ngrok -> frontend .env update.
 *
 * Returns the list of managed child processes so the CLI entrypoint can
 * clean them up on exit (Ctrl+C, error, etc).
 */
export async function runDevCommand(options: DevCommandOptions = {}): Promise<ManagedProcess[]> {
  const cwd = options.cwd ?? process.cwd();
  const managedProcesses: ManagedProcess[] = [];

  logger.title('xdev dev');

  const config = await loadOrCreateConfig({ cwd, reconfigure: options.reconfigure });
  const frontendDir = resolveFrontendPath(config, cwd);
  await validateFrontendPath(frontendDir);

  // --- Backend ---------------------------------------------------------
  const backendCommandInfo = await detectBackendCommand(cwd, config);
  logger.info(`Backend command: ${chalk.bold(backendCommandInfo.command)} (${describeSource(backendCommandInfo.source)})`);

  const portInfo = await detectBackendPort(cwd, config);
  logger.info(`Backend port: ${chalk.bold(String(portInfo.port))} (${describeSource(portInfo.source)})`);

  const portFree = await isPortFree(portInfo.port);
  if (!portFree) {
    throw new BackendError(`Port ${portInfo.port} is already in use.`, {
      hint: `Stop whatever is using port ${portInfo.port}, or set "backendPort" in .xdevrc.json to a different value.`,
    });
  }

  const backendSpinner = logger.spinner('Starting backend...').start();
  let backendHandle;
  try {
    backendHandle = await startManagedProcess({
      command: backendCommandInfo.command,
      cwd,
      tag: 'backend',
      tagColor: chalk.blue,
    });
  } catch (err) {
    backendSpinner.fail('Backend failed to start');
    throw err;
  }
  managedProcesses.push(backendHandle.process);
  backendSpinner.succeed('Backend started');

  // --- ngrok -------------------------------------------------------------
  if (config.ngrok && !options.noNgrok) {
    const ngrokSpinner = logger.spinner('Starting ngrok...').start();
    let ngrokHandle;
    try {
      ngrokHandle = await startNgrokTunnel({ port: portInfo.port });
    } catch (err) {
      ngrokSpinner.fail('ngrok failed to start');
      throw err;
    }
    managedProcesses.push(ngrokHandle.process);
    ngrokSpinner.succeed('Ngrok started');

    logger.success('URL detected');
    logger.raw('');
    logger.raw(`  ${chalk.underline.cyanBright(ngrokHandle.info.publicUrl)}`);
    logger.raw('');

    // --- Frontend .env ---------------------------------------------------
    const envSpinner = logger.spinner('Updating frontend .env...').start();
    const result = await updateFrontendEnv({
      frontendDir,
      variableName: config.envVariable,
      value: ngrokHandle.info.publicUrl,
    });
    envSpinner.succeed(
      `Frontend .env ${result.action === 'appended' ? 'updated (appended)' : 'updated'} at ${result.envPath}`
    );
  } else {
    logger.warn('Skipping ngrok (disabled via config or --no-ngrok).');
  }

  logger.divider();
  logger.success('Ready');
  logger.detail('Press Ctrl+C to stop everything.');

  return managedProcesses;
}

function describeSource(source: string): string {
  switch (source) {
    case 'config-override':
      return 'from .xdevrc.json';
    case 'package-json-script':
      return 'detected from package.json';
    case 'fallback-guess':
      return 'best-effort guess';
    case 'dotenv':
      return 'detected from .env';
    case 'process-env':
      return 'detected from environment';
    case 'user-prompt':
      return 'provided by you';
    default:
      return source;
  }
}

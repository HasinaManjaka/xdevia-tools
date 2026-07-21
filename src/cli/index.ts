#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';

import { runDevCommand } from '../commands/dev.js';
import { runDoctorCommand } from '../commands/doctor.js';
import type { ManagedProcess } from '../types/index.js';
import { isXdevError } from '../errors/index.js';
import { logger } from '../logger/index.js';

const program = new Command();

program
  .name('xdev')
  .description('XDevia local development workflow CLI')
  .version(getVersion());

program
  .command('dev')
  .description('Start the backend, tunnel it with ngrok, and wire the URL into your frontend .env')
  .option('--no-ngrok', 'Skip ngrok and only start the backend')
  .option('--reconfigure', 'Re-run the interactive setup even if already configured')
  .action(async (opts: { ngrok: boolean; reconfigure?: boolean }) => {
    await withGracefulShutdown(() =>
      runDevCommand({ noNgrok: !opts.ngrok, reconfigure: opts.reconfigure })
    );
  });

program
  .command('doctor')
  .description('Check that required tools (node, npm, ngrok, ...) are installed and working')
  .action(async () => {
    await runSafely(() => runDoctorCommand());
  });

// Reserved for future commands — adding one is just another `program.command(...)`
// block plus a new file under src/commands/, following the same pattern as
// `dev` and `doctor`. No changes needed elsewhere.
//
//   program.command('stop').description('Stop any xdev-managed processes')...
//   program.command('env').description('Inspect / sync env variables')...
//   program.command('docker').description('Manage local docker services')...
//   program.command('prisma').description('Prisma workflow shortcuts')...
//   program.command('clean').description('Clean caches / build artifacts')...

program.parseAsync(process.argv).catch(async (err) => {
  handleFatalError(err);
  process.exitCode = 1;
});

/**
 * Runs a long-lived command (one that spawns background processes) and wires
 * up Ctrl+C / termination handling so every managed child process is killed
 * before the CLI exits — nothing is left orphaned in the background.
 */
async function withGracefulShutdown(run: () => Promise<ManagedProcess[]>): Promise<void> {
  let processes: ManagedProcess[] = [];
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.raw('');
    logger.warn(`Received ${signal}, shutting down...`);
    await Promise.all(processes.map((p) => p.kill().catch(() => undefined)));
    logger.success('All processes stopped. Bye!');
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    processes = await run();
  } catch (err) {
    await Promise.all(processes.map((p) => p.kill().catch(() => undefined)));
    handleFatalError(err);
    process.exitCode = 1;
    return;
  }

  // Keep the process alive while background services run; the shutdown
  // handlers above are what actually end it.
  await new Promise<void>(() => {
    /* intentionally never resolves */
  });
}

async function runSafely(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    handleFatalError(err);
    process.exitCode = 1;
  }
}

function handleFatalError(err: unknown): void {
  if (isXdevError(err)) {
    logger.error(err.message);
    if (err.hint) logger.hint(err.hint);
    process.exitCode = err.exitCode;
    return;
  }

  if (err instanceof Error) {
    logger.error(`Unexpected error: ${err.message}`);
    logger.hint('If this keeps happening, please open an issue with the steps to reproduce.');
    if (process.env['XDEV_DEBUG']) {
      logger.raw(chalk.dim(err.stack ?? ''));
    }
    return;
  }

  logger.error(`Unexpected error: ${String(err)}`);
}

function getVersion(): string {
  // Kept dependency-free (no reading package.json at runtime paths that
  // differ between ts-node and the compiled dist/ layout); bumped manually
  // alongside package.json during releases.
  return '0.1.0';
}

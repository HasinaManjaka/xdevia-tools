/**
 * Centralized, colorized console output for the CLI.
 *
 * Keeping all presentation logic here means commands and services never
 * import chalk/ora directly — they just call `logger.xxx(...)`. This makes
 * the rest of the codebase trivial to unit test (mock the logger, assert on
 * calls) and keeps visual style consistent and easy to change in one place.
 */

import chalk from 'chalk';
import ora, { type Ora } from 'ora';

export interface Logger {
  title(text: string): void;
  info(text: string): void;
  success(text: string): void;
  warn(text: string): void;
  error(text: string): void;
  hint(text: string): void;
  detail(text: string): void;
  raw(text: string): void;
  spinner(text: string): Ora;
  divider(): void;
}

const prefixSuccess = chalk.green('✔');
const prefixError = chalk.red('✖');
const prefixWarn = chalk.yellow('⚠');
const prefixInfo = chalk.cyan('ℹ');

export const logger: Logger = {
  title(text: string): void {
    console.log('\n' + chalk.bold.magentaBright(text));
  },

  info(text: string): void {
    console.log(`${prefixInfo} ${chalk.white(text)}`);
  },

  success(text: string): void {
    console.log(`${prefixSuccess} ${chalk.greenBright(text)}`);
  },

  warn(text: string): void {
    console.log(`${prefixWarn} ${chalk.yellow(text)}`);
  },

  error(text: string): void {
    console.error(`${prefixError} ${chalk.redBright(text)}`);
  },

  hint(text: string): void {
    console.log(`  ${chalk.dim('→')} ${chalk.dim(text)}`);
  },

  detail(text: string): void {
    console.log(`  ${chalk.gray(text)}`);
  },

  raw(text: string): void {
    console.log(text);
  },

  spinner(text: string): Ora {
    return ora({ text, color: 'cyan' });
  },

  divider(): void {
    console.log(chalk.gray('─'.repeat(48)));
  },
};

/** Prefixes each line of streamed child-process output with a colored tag. */
export function taggedLine(tag: string, color: (s: string) => string, line: string): string {
  return `${color(`[${tag}]`)} ${line}`;
}

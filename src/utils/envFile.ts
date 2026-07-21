/**
 * Line-based .env reader/writer that preserves comments, blank lines,
 * ordering, and quoting style for every variable it doesn't touch.
 *
 * We deliberately avoid parsing into an object and re-serializing the whole
 * file (that would destroy comments/formatting). Instead we operate line by
 * line and only rewrite the one line that matters.
 */

const ASSIGNMENT_PATTERN = /^(\s*)([\w.-]+)(\s*=\s*)(.*)$/;

export interface EnvPatchResult {
  content: string;
  changed: boolean;
  action: 'replaced' | 'appended';
}

/**
 * Sets `key=value` inside `envContent`.
 * - If the key already exists (even commented-out is ignored — only active
 *   assignments count), only its value is replaced; everything else on the
 *   line (leading whitespace, spacing around `=`) is preserved.
 * - If the key does not exist, a new line is appended at the end, preceded
 *   by a newline if the file doesn't already end with one.
 */
export function setEnvVariable(envContent: string, key: string, value: string): EnvPatchResult {
  const lines = envContent.split(/\r?\n/);
  const serializedValue = serializeValue(value);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const match = ASSIGNMENT_PATTERN.exec(line);
    if (match && match[2] === key) {
      const [, indent, , equalsPart] = match;
      lines[i] = `${indent}${key}${equalsPart}${serializedValue}`;
      return { content: lines.join('\n'), changed: true, action: 'replaced' };
    }
  }

  // Not found: append. Handle trailing-newline bookkeeping cleanly.
  const trimmedTrailingBlank = envContent.length === 0;
  const needsLeadingNewline = !trimmedTrailingBlank && !envContent.endsWith('\n');
  const separator = needsLeadingNewline ? '\n' : '';
  const newLine = `${key}=${serializedValue}`;
  const newContent = trimmedTrailingBlank
    ? `${newLine}\n`
    : `${envContent}${separator}${newLine}\n`;

  return { content: newContent, changed: true, action: 'appended' };
}

/** Reads a single variable's current value from .env content, if present. */
export function getEnvVariable(envContent: string, key: string): string | undefined {
  const lines = envContent.split(/\r?\n/);
  for (const line of lines) {
    const match = ASSIGNMENT_PATTERN.exec(line);
    if (match && match[2] === key) {
      return unquote(match[4] ?? '');
    }
  }
  return undefined;
}

/** Quotes the value only if it contains characters that would otherwise break parsing. */
function serializeValue(value: string): string {
  const needsQuoting = /[\s#"'\\]/.test(value);
  if (!needsQuoting) return value;
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function unquote(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Minimal .env parser used only for reading (e.g. detecting backend PORT). Does not preserve formatting. */
export function parseEnv(envContent: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = ASSIGNMENT_PATTERN.exec(line);
    if (match) {
      result[match[2] as string] = unquote(match[4] ?? '');
    }
  }
  return result;
}

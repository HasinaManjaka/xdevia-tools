import { describe, expect, it } from 'vitest';
import { getEnvVariable, parseEnv, setEnvVariable } from '../src/utils/envFile.js';

describe('setEnvVariable', () => {
  it('appends the variable when the file is empty', () => {
    const result = setEnvVariable('', 'EXPO_PUBLIC_DEV_API_URL', 'https://abc.ngrok-free.dev');
    expect(result.action).toBe('appended');
    expect(result.content).toBe('EXPO_PUBLIC_DEV_API_URL=https://abc.ngrok-free.dev\n');
  });

  it('appends the variable when missing, preserving existing content and trailing newline', () => {
    const original = 'FOO=bar\nBAZ=qux\n';
    const result = setEnvVariable(original, 'EXPO_PUBLIC_DEV_API_URL', 'https://abc.ngrok-free.dev');
    expect(result.action).toBe('appended');
    expect(result.content).toBe('FOO=bar\nBAZ=qux\nEXPO_PUBLIC_DEV_API_URL=https://abc.ngrok-free.dev\n');
  });

  it('adds a newline before appending when the file does not end with one', () => {
    const original = 'FOO=bar';
    const result = setEnvVariable(original, 'NEW_VAR', 'value');
    expect(result.content).toBe('FOO=bar\nNEW_VAR=value\n');
  });

  it('replaces only the value when the key already exists', () => {
    const original = '# comment\nFOO=bar\nEXPO_PUBLIC_DEV_API_URL=https://old.ngrok-free.dev\nBAZ=qux\n';
    const result = setEnvVariable(original, 'EXPO_PUBLIC_DEV_API_URL', 'https://new.ngrok-free.dev');
    expect(result.action).toBe('replaced');
    expect(result.content).toBe(
      '# comment\nFOO=bar\nEXPO_PUBLIC_DEV_API_URL=https://new.ngrok-free.dev\nBAZ=qux\n'
    );
  });

  it('preserves indentation and spacing around the equals sign', () => {
    const original = '  EXPO_PUBLIC_DEV_API_URL   =   https://old.dev\n';
    const result = setEnvVariable(original, 'EXPO_PUBLIC_DEV_API_URL', 'https://new.dev');
    expect(result.content).toBe('  EXPO_PUBLIC_DEV_API_URL   =   https://new.dev\n');
  });

  it('quotes values containing whitespace or special characters', () => {
    const result = setEnvVariable('', 'MY_VAR', 'value with spaces');
    expect(result.content).toContain('MY_VAR="value with spaces"');
  });

  it('does not touch commented-out lines with the same key', () => {
    const original = '# EXPO_PUBLIC_DEV_API_URL=https://commented-out.dev\n';
    const result = setEnvVariable(original, 'EXPO_PUBLIC_DEV_API_URL', 'https://new.dev');
    expect(result.action).toBe('appended');
    expect(result.content).toContain('# EXPO_PUBLIC_DEV_API_URL=https://commented-out.dev');
    expect(result.content).toContain('EXPO_PUBLIC_DEV_API_URL=https://new.dev');
  });

  it('preserves unrelated blank lines and comments', () => {
    const original = '# header comment\n\nFOO=bar\n\n# footer\n';
    const result = setEnvVariable(original, 'NEW_VAR', 'val');
    expect(result.content).toBe('# header comment\n\nFOO=bar\n\n# footer\nNEW_VAR=val\n');
  });
});

describe('getEnvVariable', () => {
  it('returns undefined when the key is absent', () => {
    expect(getEnvVariable('FOO=bar\n', 'MISSING')).toBeUndefined();
  });

  it('returns the unquoted value when present', () => {
    expect(getEnvVariable('FOO="bar baz"\n', 'FOO')).toBe('bar baz');
  });
});

describe('parseEnv', () => {
  it('ignores comments and blank lines', () => {
    const parsed = parseEnv('# comment\n\nFOO=bar\nPORT=4000\n');
    expect(parsed).toEqual({ FOO: 'bar', PORT: '4000' });
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';

const readFileMock = vi.fn();
const writeFileMock = vi.fn();
const accessMock = vi.fn();

vi.mock('node:fs', () => ({
  promises: {
    readFile: (...args: unknown[]) => readFileMock(...args),
    writeFile: (...args: unknown[]) => writeFileMock(...args),
    access: (...args: unknown[]) => accessMock(...args),
  },
}));

import { updateFrontendEnv } from '../src/services/frontend/envUpdater.js';
import { EnvFileError } from '../src/errors/index.js';

describe('updateFrontendEnv', () => {
  beforeEach(() => {
    readFileMock.mockReset();
    writeFileMock.mockReset();
    accessMock.mockReset();
  });

  it('creates a fresh .env with just the new variable when none exists', async () => {
    accessMock.mockRejectedValue(new Error('ENOENT'));

    const result = await updateFrontendEnv({
      frontendDir: '/repo/frontend',
      variableName: 'EXPO_PUBLIC_DEV_API_URL',
      value: 'https://abc.ngrok-free.dev',
    });

    expect(result.action).toBe('appended');
    expect(writeFileMock).toHaveBeenCalledWith(
      '/repo/frontend/.env',
      'EXPO_PUBLIC_DEV_API_URL=https://abc.ngrok-free.dev\n',
      'utf-8'
    );
  });

  it('replaces an existing variable in place, preserving other lines', async () => {
    accessMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue('FOO=bar\nEXPO_PUBLIC_DEV_API_URL=https://old.dev\n');

    const result = await updateFrontendEnv({
      frontendDir: '/repo/frontend',
      variableName: 'EXPO_PUBLIC_DEV_API_URL',
      value: 'https://new.dev',
    });

    expect(result.action).toBe('replaced');
    expect(writeFileMock).toHaveBeenCalledWith(
      '/repo/frontend/.env',
      'FOO=bar\nEXPO_PUBLIC_DEV_API_URL=https://new.dev\n',
      'utf-8'
    );
  });

  it('wraps write failures in an EnvFileError with a helpful hint', async () => {
    accessMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue('FOO=bar\n');
    writeFileMock.mockRejectedValue(new Error('EACCES: permission denied'));

    await expect(
      updateFrontendEnv({
        frontendDir: '/repo/frontend',
        variableName: 'EXPO_PUBLIC_DEV_API_URL',
        value: 'https://new.dev',
      })
    ).rejects.toThrow(EnvFileError);
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';

const readFileMock = vi.fn();
const accessMock = vi.fn();
const statMock = vi.fn();

vi.mock('node:fs', () => ({
  promises: {
    readFile: (...args: unknown[]) => readFileMock(...args),
    access: (...args: unknown[]) => accessMock(...args),
    stat: (...args: unknown[]) => statMock(...args),
  },
}));

import { detectBackendCommand } from '../src/services/backend/commandDetector.js';
import { BackendError } from '../src/errors/index.js';
import type { XdevConfig } from '../src/types/index.js';

const baseConfig: XdevConfig = {
  frontendPath: '../frontend',
  envVariable: 'EXPO_PUBLIC_DEV_API_URL',
  ngrok: true,
  version: 1,
};

describe('detectBackendCommand', () => {
  beforeEach(() => {
    readFileMock.mockReset();
    accessMock.mockReset();
    statMock.mockReset();
    statMock.mockResolvedValue({ isFile: () => true, isDirectory: () => false }); // package.json "exists" by default
    accessMock.mockResolvedValue(undefined); // entry-file guess checks default to "found"
  });

  it('uses the config override when present, without touching the filesystem', async () => {
    const config: XdevConfig = { ...baseConfig, backendCommand: 'custom start command' };
    const result = await detectBackendCommand('/repo/backend', config);
    expect(result).toEqual({ command: 'custom start command', source: 'config-override' });
  });

  it('prefers "dev:server" over "dev" when both scripts exist', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({ scripts: { dev: 'node index.js', 'dev:server': 'tsx watch src/server.ts' } })
    );
    const result = await detectBackendCommand('/repo/backend', baseConfig);
    expect(result.command).toBe('npm run dev:server');
    expect(result.source).toBe('package-json-script');
  });

  it('falls back to "dev" when "dev:server" is absent', async () => {
    readFileMock.mockResolvedValue(JSON.stringify({ scripts: { dev: 'node index.js' } }));
    const result = await detectBackendCommand('/repo/backend', baseConfig);
    expect(result.command).toBe('npm run dev');
  });

  it('throws a BackendError with a helpful hint when no script matches', async () => {
    readFileMock.mockResolvedValue(JSON.stringify({ scripts: { build: 'tsc' } }));
    accessMock.mockRejectedValue(new Error('ENOENT')); // no guessable entry file found either
    await expect(detectBackendCommand('/repo/backend', baseConfig)).rejects.toThrow(BackendError);
  });

  it('throws a BackendError on malformed package.json', async () => {
    readFileMock.mockResolvedValue('{ not valid json');
    await expect(detectBackendCommand('/repo/backend', baseConfig)).rejects.toThrow(BackendError);
  });
});

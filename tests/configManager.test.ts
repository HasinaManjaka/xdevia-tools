import { describe, expect, it, vi, beforeEach } from 'vitest';

const readFileMock = vi.fn();
const writeFileMock = vi.fn();
const mkdirMock = vi.fn();
const statMock = vi.fn();
const accessMock = vi.fn();

vi.mock('node:fs', () => ({
  promises: {
    readFile: (...args: unknown[]) => readFileMock(...args),
    writeFile: (...args: unknown[]) => writeFileMock(...args),
    mkdir: (...args: unknown[]) => mkdirMock(...args),
    stat: (...args: unknown[]) => statMock(...args),
    access: (...args: unknown[]) => accessMock(...args),
  },
}));

const promptsMock = vi.fn();
vi.mock('prompts', () => ({
  default: (...args: unknown[]) => promptsMock(...args),
}));

import { loadOrCreateConfig } from '../src/config/configManager.js';
import { ConfigError, UserCancelledError } from '../src/errors/index.js';

describe('loadOrCreateConfig', () => {
  beforeEach(() => {
    readFileMock.mockReset();
    writeFileMock.mockReset();
    mkdirMock.mockReset();
    statMock.mockReset();
    accessMock.mockReset();
    promptsMock.mockReset();
    mkdirMock.mockResolvedValue(undefined);
  });

  it('loads an existing valid config without prompting', async () => {
    statMock.mockResolvedValue({ isFile: () => true, isDirectory: () => false });
    readFileMock.mockResolvedValue(
      JSON.stringify({ frontendPath: '../frontend', envVariable: 'X', ngrok: true, version: 1 })
    );

    const config = await loadOrCreateConfig({ cwd: '/repo/backend' });
    expect(config.frontendPath).toBe('../frontend');
    expect(config.envVariable).toBe('X');
    expect(promptsMock).not.toHaveBeenCalled();
  });

  it('throws ConfigError on malformed JSON', async () => {
    statMock.mockResolvedValue({ isFile: () => true, isDirectory: () => false });
    readFileMock.mockResolvedValue('{ not valid json');

    await expect(loadOrCreateConfig({ cwd: '/repo/backend' })).rejects.toThrow(ConfigError);
  });

  it('runs interactive setup and saves config when none exists', async () => {
    // First stat call: config file existence check -> reject (not found)
    statMock.mockRejectedValueOnce(new Error('ENOENT'));
    promptsMock.mockResolvedValue({ frontendPath: '../frontend' });
    // Subsequent stat calls during validateFrontendPath: directory exists, package.json exists
    statMock.mockResolvedValueOnce({ isFile: () => false, isDirectory: () => true }); // frontend dir
    statMock.mockResolvedValueOnce({ isFile: () => true, isDirectory: () => false }); // package.json
    accessMock.mockResolvedValue(undefined); // .env exists

    const config = await loadOrCreateConfig({ cwd: '/repo/backend' });
    expect(config.frontendPath).toBe('../frontend');
    expect(writeFileMock).toHaveBeenCalled(); // .xdevrc.json written
  });

  it('throws UserCancelledError when the user cancels the prompt', async () => {
    statMock.mockRejectedValueOnce(new Error('ENOENT'));
    promptsMock.mockImplementation((_q: unknown, opts: { onCancel: () => void }) => {
      opts.onCancel();
      return Promise.resolve({});
    });

    await expect(loadOrCreateConfig({ cwd: '/repo/backend' })).rejects.toThrow(UserCancelledError);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** localStorage stand-in; the settings store reads it at module load. */
class MemoryStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

const SETTINGS_KEY = 'openjarvis-settings';

let storage: MemoryStorage;

beforeEach(() => {
  vi.resetModules();
  storage = new MemoryStorage();
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;
});

afterEach(() => {
  (globalThis as unknown as { localStorage?: MemoryStorage }).localStorage = undefined;
});

describe('voice defaults', () => {
  it('starts a fresh profile with voice output and autoplay on', async () => {
    const { useAppStore } = await import('./store');
    const { settings } = useAppStore.getState();

    expect(settings.voiceOutputEnabled).toBe(true);
    expect(settings.voiceAutoplay).toBe(true);
    // Empty voice means "use whatever config.toml configured".
    expect(settings.voiceId).toBe('');
  });

  it('applies the new default once to a profile saved before it', async () => {
    storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        theme: 'dark',
        voiceOutputEnabled: false,
        voiceAutoplay: false,
      }),
    );

    const { useAppStore } = await import('./store');
    const { settings } = useAppStore.getState();

    expect(settings.voiceOutputEnabled).toBe(true);
    expect(settings.voiceAutoplay).toBe(true);
    // Unrelated preferences survive the migration.
    expect(settings.theme).toBe('dark');
  });

  it('respects an explicit choice once the profile is versioned', async () => {
    storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        voiceOutputEnabled: false,
        voiceAutoplay: false,
        settingsVersion: 2,
      }),
    );

    const { useAppStore } = await import('./store');

    expect(useAppStore.getState().settings.voiceOutputEnabled).toBe(false);
  });

  it('persists a chosen voice across reloads', async () => {
    const first = await import('./store');
    first.useAppStore.getState().updateSettings({ voiceId: 'Bryony' });

    vi.resetModules();
    const second = await import('./store');

    expect(second.useAppStore.getState().settings.voiceId).toBe('Bryony');
  });
});
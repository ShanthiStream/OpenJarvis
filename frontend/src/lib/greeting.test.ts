import { describe, expect, it } from 'vitest';

import {
  buildStartupGreeting,
  claimStartupGreeting,
  dayPart,
  STARTUP_GREETING_KEY,
} from './greeting';

/** Local-time date at a given hour, so the test is not timezone dependent. */
function at(hour: number): Date {
  return new Date(2026, 4, 1, hour, 30, 0);
}

describe('dayPart', () => {
  it('maps the hour onto the three spoken parts of the day', () => {
    expect(dayPart(at(0))).toBe('evening');
    expect(dayPart(at(4))).toBe('evening');
    expect(dayPart(at(5))).toBe('morning');
    expect(dayPart(at(11))).toBe('morning');
    expect(dayPart(at(12))).toBe('afternoon');
    expect(dayPart(at(17))).toBe('afternoon');
    expect(dayPart(at(18))).toBe('evening');
    expect(dayPart(at(23))).toBe('evening');
  });
});

describe('buildStartupGreeting', () => {
  it('addresses the user by name, then by honorific', () => {
    expect(buildStartupGreeting({ name: 'Dinesh', date: at(20) })).toBe(
      'Good evening, Dinesh. All systems are online, and I am standing by, sir.',
    );
  });

  it('follows the time of day', () => {
    expect(buildStartupGreeting({ name: 'Dinesh', date: at(8) })).toContain('Good morning, Dinesh.');
    expect(buildStartupGreeting({ name: 'Dinesh', date: at(14) })).toContain('Good afternoon, Dinesh.');
    expect(buildStartupGreeting({ name: 'Dinesh', date: at(19) })).toContain('Good evening, Dinesh.');
  });

  it('drops the name and honorific cleanly when they are empty', () => {
    const line = buildStartupGreeting({ name: '   ', honorific: '', date: at(9) });
    expect(line).toBe('Good morning. All systems are online, and I am standing by.');
  });
});

describe('claimStartupGreeting', () => {
  function memoryStorage() {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
  }

  it('greets once per session, so re-renders do not repeat the line', () => {
    const storage = memoryStorage();

    expect(claimStartupGreeting(storage)).toBe(true);
    expect(claimStartupGreeting(storage)).toBe(false);
  });

  it('uses a key that a reload cannot confuse with something else', () => {
    const storage = memoryStorage();
    claimStartupGreeting(storage);
    expect(storage.getItem(STARTUP_GREETING_KEY)).not.toBeNull();
  });

  it('greets anyway when storage is unavailable', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };

    expect(claimStartupGreeting(broken)).toBe(true);
  });
});
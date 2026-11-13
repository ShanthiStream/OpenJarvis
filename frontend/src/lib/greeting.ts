/**
 * The line Jarvis speaks when the GUI comes up.
 *
 * Kept in one place so the spoken greeting and any on-screen copy cannot drift
 * apart, and so the wording is unit-testable without a browser.
 */

export type DayPart = 'morning' | 'afternoon' | 'evening';

/** Time of day for the greeting; late night still reads as evening. */
export function dayPart(date: Date = new Date()): DayPart {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

export interface GreetingOptions {
  /** The user's name, e.g. "Dinesh". Omitted from the line when empty. */
  name?: string;
  /** How Jarvis addresses the user after the name, e.g. "sir". */
  honorific?: string;
  date?: Date;
}

/**
 * Build the startup line, e.g.
 *   "Good evening, Dinesh. All systems are online, and I am standing by, sir."
 *
 * Short on purpose: every extra clause is extra synthesis latency before the
 * user hears anything.
 */
export function buildStartupGreeting({
  name = '',
  honorific = 'sir',
  date = new Date(),
}: GreetingOptions = {}): string {
  const who = name.trim();
  const addressee = who ? `, ${who}` : '';
  const signOff = honorific.trim() ? `, ${honorific.trim()}` : '';
  return `Good ${dayPart(date)}${addressee}. All systems are online, and I am standing by${signOff}.`;
}

export const STARTUP_GREETING_KEY = 'openjarvis-startup-greeting';

/**
 * Claim the startup greeting for this browsing session.
 *
 * Returns true at most once per session, so a re-render, a StrictMode
 * double-mount, or a route change never repeats the line -- but reloading the
 * app counts as starting Jarvis again, which is the point.
 */
export function claimStartupGreeting(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  key: string = STARTUP_GREETING_KEY,
): boolean {
  try {
    if (storage.getItem(key)) return false;
    storage.setItem(key, String(Date.now()));
    return true;
  } catch {
    // Private mode / disabled storage: greet anyway rather than never.
    return true;
  }
}
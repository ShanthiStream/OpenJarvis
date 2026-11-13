import { useEffect } from 'react';

import { useTtsStore } from '../lib/tts';
import { useAppStore } from '../lib/store';
import { buildStartupGreeting, claimStartupGreeting } from '../lib/greeting';

/** Pseudo message id for the startup line; it has no chat message behind it. */
const GREETING_ID = '__startup-greeting__';

/**
 * Speaks Jarvis' introduction once per app start.
 *
 * Mounted at the app root rather than inside the chat, so the greeting happens
 * whenever the GUI comes up -- on the dashboard or settings too. It stays quiet
 * unless voice output is enabled and a TTS backend answers; and because the
 * browser will not play audio without a gesture, a blocked start is armed for
 * the user's first click instead of raising an error.
 */
export function StartupGreeting() {
  const voiceOutputEnabled = useAppStore((s) => s.settings.voiceOutputEnabled);
  const greetingEnabled = useAppStore((s) => s.settings.voiceGreetingEnabled);
  const userName = useAppStore((s) => s.settings.userName);

  useEffect(() => {
    if (!voiceOutputEnabled || !greetingEnabled) return;

    let cancelled = false;
    void useTtsStore
      .getState()
      .ensureHealth()
      .then(() => {
        if (cancelled) return;
        const tts = useTtsStore.getState();
        // A probe that finds no backend must not leave a dangling attempt.
        if (tts.available !== true) return;
        // Someone already asked for audio (a reply they sent); do not talk over it.
        if (tts.state !== 'idle') return;
        // Claim only once we are actually about to speak: React StrictMode runs
        // this effect twice in development, and claiming up front would let the
        // discarded first pass swallow the greeting.
        if (!claimStartupGreeting(sessionStorage)) return;

        void tts.speak(
          GREETING_ID,
          buildStartupGreeting({ name: userName }),
          {
            voiceId: useAppStore.getState().settings.voiceId,
            deferUntilGesture: true,
          },
        );
      });

    return () => {
      cancelled = true;
    };
  }, [voiceOutputEnabled, greetingEnabled, userName]);

  return null;
}
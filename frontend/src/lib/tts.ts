import { create } from 'zustand';
import { synthesizeSpeech, fetchTtsHealth } from './api';
import { toSpeakableText } from './message-text';

export type TtsState = 'idle' | 'loading' | 'speaking';

export interface SpeakOptions {
  /**
   * Voice to synthesize with. Omitted or empty defers to the server, which uses
   * ``[speech].voice_id`` from config.toml -- so callers that do not care never
   * have to know which backend is active.
   */
  voiceId?: string;
  /**
   * Wait for the next user gesture if the browser refuses to start playback.
   *
   * Browsers block audio that is not tied to a gesture, which is exactly the
   * situation a greeting on app start is in. With this set, a blocked start is
   * armed for the first click/keypress instead of surfacing as an error -- the
   * line is already synthesized, so it plays the moment the user touches the
   * window. Replies never set this: they follow a click, so a rejection there
   * is a real failure worth reporting.
   */
  deferUntilGesture?: boolean;
}

/** Events that count as the gesture browsers require before playing audio. */
const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

/**
 * Voice output is a single shared resource: one utterance at a time, for the
 * whole app. The state lives in one store rather than per component, because a
 * per-component hook would give every message its own audio element -- two
 * replies would then talk over each other, and autoplay would make that the
 * normal case rather than the exception.
 */
interface TtsStore {
  state: TtsState;
  /** id of the message currently loading or speaking, if any. */
  speakingId: string | null;
  error: string | null;
  /** Message whose read-aloud attempt failed, if any. */
  errorId: string | null;
  /** null until the health probe has answered. */
  available: boolean | null;
  /** Last message spoken by autoplay, so a re-render never repeats it. */
  autoSpokenId: string | null;
  speak: (id: string, text: string, options?: SpeakOptions) => Promise<void>;
  stop: () => void;
  ensureHealth: () => Promise<void>;
  markAutoSpoken: (id: string) => void;
}

// Playback handles are not render state -- keeping them out of the store avoids
// re-rendering every subscriber when an audio element is swapped.
let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let controller: AbortController | null = null;
let token = 0;
let healthProbe: Promise<void> | null = null;
/** Detaches the gesture listeners armed for a deferred start, if any. */
let disarmGesture: (() => void) | null = null;

/** Only a stream ending in the active conversation may trigger autoplay. */
export function shouldAutoplayFinishedReply(
  previousStreamingConversationId: string | null,
  activeId: string | null,
  streamIsActive: boolean,
  lastMessage: { id: string; role: string } | undefined,
  autoSpokenId: string | null,
): boolean {
  return previousStreamingConversationId !== null
    && previousStreamingConversationId === activeId
    && !streamIsActive
    && lastMessage !== undefined
    && lastMessage.role === 'assistant'
    && lastMessage.id !== autoSpokenId;
}

function teardown(): void {
  if (disarmGesture) {
    disarmGesture();
    disarmGesture = null;
  }
  if (audio) {
    // Detach first: clearing src re-runs the media load algorithm, which fails
    // on an empty source and dispatches an `error` event. With the handler
    // still attached that surfaces as a bogus "Playback failed" after every
    // successful utterance.
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.src = '';
    audio = null;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  if (controller) {
    controller.abort();
    controller = null;
  }
}

/** True when `play()` was rejected because the browser wants a gesture first. */
function isAutoplayBlocked(err: unknown): boolean {
  // Chrome/Safari reject with NotAllowedError; Firefox uses the same name.
  return err instanceof DOMException && err.name === 'NotAllowedError';
}

/**
 * Retry `play()` on the next user gesture.
 *
 * Registered once per utterance and torn down with it, so a greeting that the
 * user ignores leaves no listener behind after the first click.
 */
function armGesturePlayback(
  el: HTMLAudioElement,
  mine: number,
  id: string,
  set: (partial: Partial<TtsStore>) => void,
): void {
  if (typeof document === 'undefined') return;

  const disarm = () => {
    for (const event of GESTURE_EVENTS) document.removeEventListener(event, attempt, true);
    if (disarmGesture === disarm) disarmGesture = null;
  };

  function attempt() {
    if (mine !== token || audio !== el) {
      disarm();
      return;
    }
    void el
      .play()
      .then(() => {
        disarm();
        if (mine !== token) return;
        set({ state: 'speaking', speakingId: id, error: null, errorId: null });
      })
      .catch(() => disarm());
  }

  for (const event of GESTURE_EVENTS) document.addEventListener(event, attempt, true);
  disarmGesture = disarm;
}

export const useTtsStore = create<TtsStore>((set, get) => ({
  state: 'idle',
  speakingId: null,
  error: null,
  errorId: null,
  available: null,
  autoSpokenId: null,

  ensureHealth: () => {
    if (healthProbe) return healthProbe;
    healthProbe = fetchTtsHealth()
      .then((health) => {
        set({ available: health.available });
        if (!health.available) healthProbe = null;
      })
      .catch(() => {
        set({ available: false });
        healthProbe = null;
      });
    return healthProbe;
  },

  markAutoSpoken: (id: string) => set({ autoSpokenId: id }),

  speak: async (id: string, text: string, options: SpeakOptions = {}) => {
    const trimmed = toSpeakableText(text);
    if (!trimmed) return;

    // Bump before teardown so a synthesis still in flight is both aborted and
    // fenced off by the token, even if the abort loses the race.
    token += 1;
    const mine = token;
    teardown();
    set({ state: 'loading', speakingId: id, error: null, errorId: null });

    const ac = new AbortController();
    controller = ac;

    try {
      // Empty voiceId defers to the server, which uses `[speech].voice_id` from
      // config.toml. A chosen voice overrides it per request.
      const blob = await synthesizeSpeech(trimmed, {
        signal: ac.signal,
        voiceId: options.voiceId || undefined,
      });
      if (mine !== token) return;

      const url = URL.createObjectURL(blob);
      objectUrl = url;
      const el = new Audio(url);
      audio = el;

      el.onended = () => {
        if (mine !== token) return;
        teardown();
        set({ state: 'idle', speakingId: null });
      };
      el.onerror = () => {
        if (mine !== token) return;
        teardown();
        set({ state: 'idle', speakingId: null, error: 'Playback failed', errorId: id });
      };

      await el.play();
      if (mine === token) set({ state: 'speaking', speakingId: id });
    } catch (err) {
      if (mine !== token) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;

      // Autoplay refusal is not a failure the user can act on: the browser
      // simply has not seen a gesture yet. Arm playback for the next one and
      // leave the error slots empty so no "Playback failed" flash appears.
      if (options.deferUntilGesture && isAutoplayBlocked(err) && audio) {
        armGesturePlayback(audio, mine, id, set);
        set({ state: 'idle', speakingId: null });
        return;
      }

      teardown();
      set({
        state: 'idle',
        speakingId: null,
        error: err instanceof Error ? err.message : 'Speech synthesis failed',
        errorId: id,
      });
    }
  },

  stop: () => {
    token += 1;
    teardown();
    set({ state: 'idle', speakingId: null, error: null, errorId: null });
  },
}));

/** Test seam: reset module-level playback handles between cases. */
export function __resetTtsForTests(): void {
  teardown();
  token = 0;
  healthProbe = null;
  useTtsStore.setState({
    state: 'idle',
    speakingId: null,
    error: null,
    errorId: null,
    available: null,
    autoSpokenId: null,
  });
}

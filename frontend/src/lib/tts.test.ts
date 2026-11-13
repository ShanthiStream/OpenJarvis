import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  synthesizeSpeech: vi.fn(),
  fetchTtsHealth: vi.fn(),
}));

import { synthesizeSpeech, fetchTtsHealth } from './api';
import { useTtsStore, __resetTtsForTests, shouldAutoplayFinishedReply } from './tts';

const synth = vi.mocked(synthesizeSpeech);
const health = vi.mocked(fetchTtsHealth);

/** Minimal HTMLAudioElement stand-in; jsdom cannot decode or play real audio. */
class FakeAudio {
  static instances: FakeAudio[] = [];
  static blockedPlays = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src: string;
  paused = false;
  playCalls = 0;

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  play(): Promise<void> {
    this.playCalls += 1;
    // Consumed one at a time so a test can block the first attempt (autoplay
    // policy) and let the retry through.
    if (FakeAudio.blockedPlays > 0) {
      FakeAudio.blockedPlays -= 1;
      return Promise.reject(new DOMException('play() failed', 'NotAllowedError'));
    }
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }
}

const created: string[] = [];
const revoked: string[] = [];
let urlCounter = 0;

beforeEach(() => {
  vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
  vi.stubGlobal('URL', {
    createObjectURL: () => {
      const url = `blob:fake/${++urlCounter}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  });

  synth.mockReset();
  health.mockReset();

  // Reset the store first: it tears down whatever the previous test left
  // playing, and that teardown revokes a URL. Clearing the ledgers afterwards
  // keeps that bookkeeping out of this test's assertions.
  __resetTtsForTests();
  FakeAudio.instances = [];
  FakeAudio.blockedPlays = 0;
  created.length = 0;
  revoked.length = 0;
  urlCounter = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('shared voice output', () => {
  it('plays one utterance and reports which message owns it', async () => {
    synth.mockResolvedValue(new Blob(['wav']));

    await useTtsStore.getState().speak('m1', 'Hallo');

    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].playCalls).toBe(1);
    expect(useTtsStore.getState().state).toBe('speaking');
    expect(useTtsStore.getState().speakingId).toBe('m1');
  });

  it('starting a second message stops the first instead of overlapping it', async () => {
    synth.mockResolvedValue(new Blob(['wav']));

    await useTtsStore.getState().speak('m1', 'Erste');
    const first = FakeAudio.instances[0];

    await useTtsStore.getState().speak('m2', 'Zweite');

    expect(first.paused).toBe(true);
    expect(useTtsStore.getState().speakingId).toBe('m2');
    expect(revoked).toContain(created[0]);
  });

  it('sends the chosen voice, and lets the server pick when none is chosen', async () => {
    synth.mockResolvedValue(new Blob(['wav']));

    await useTtsStore.getState().speak('m1', 'Hallo', { voiceId: 'Bryony' });
    expect(synth.mock.calls[0][1]?.voiceId).toBe('Bryony');

    // No voice chosen: the field is omitted so the server falls back to
    // `[speech].voice_id` in config.toml.
    await useTtsStore.getState().speak('m2', 'Hallo');
    expect(synth.mock.calls[1][1]?.voiceId).toBeUndefined();
  });

  it('aborts a synthesis that is superseded before it resolves', async () => {
    const pending = deferred<Blob>();
    synth.mockReturnValueOnce(pending.promise);
    synth.mockResolvedValueOnce(new Blob(['wav']));

    const firstCall = useTtsStore.getState().speak('m1', 'Erste');
    const signal = synth.mock.calls[0][1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    await useTtsStore.getState().speak('m2', 'Zweite');
    expect(signal.aborted).toBe(true);

    // The stale response must not start playback or leak its blob URL.
    pending.resolve(new Blob(['stale']));
    await firstCall;

    expect(FakeAudio.instances).toHaveLength(1);
    expect(useTtsStore.getState().speakingId).toBe('m2');
  });

  it('stop() halts playback and revokes the blob URL', async () => {
    synth.mockResolvedValue(new Blob(['wav']));

    await useTtsStore.getState().speak('m1', 'Hallo');
    useTtsStore.getState().stop();

    expect(FakeAudio.instances[0].paused).toBe(true);
    expect(revoked).toEqual(created);
    expect(useTtsStore.getState().state).toBe('idle');
    expect(useTtsStore.getState().speakingId).toBeNull();
  });

  it('finishing playback leaves no error behind', async () => {
    synth.mockResolvedValue(new Blob(['wav']));

    await useTtsStore.getState().speak('m1', 'Hallo');
    const el = FakeAudio.instances[0];

    el.onended?.();
    // Clearing src fires a media error; the handler must already be detached.
    el.onerror?.();

    expect(useTtsStore.getState().error).toBeNull();
    expect(useTtsStore.getState().state).toBe('idle');
    expect(revoked).toEqual(created);
  });

  it('surfaces a synthesis failure', async () => {
    synth.mockRejectedValue(new Error('No text-to-speech backend available'));

    await useTtsStore.getState().speak('m1', 'Hallo');

    expect(useTtsStore.getState().error).toBe('No text-to-speech backend available');
    expect(useTtsStore.getState().errorId).toBe('m1');
    expect(useTtsStore.getState().state).toBe('idle');
  });

  it('ignores empty text', async () => {
    await useTtsStore.getState().speak('m1', '   ');
    expect(synth).not.toHaveBeenCalled();
  });

  it('probes the backend once no matter how many callers ask', () => {
    health.mockResolvedValue({ available: true });

    useTtsStore.getState().ensureHealth();
    useTtsStore.getState().ensureHealth();
    useTtsStore.getState().ensureHealth();

    expect(health).toHaveBeenCalledTimes(1);
  });

  it('shares a pending health probe so autoplay can wait for model loading', async () => {
    const pending = deferred<{ available: boolean }>();
    health.mockReturnValue(pending.promise);

    const first = useTtsStore.getState().ensureHealth();
    const second = useTtsStore.getState().ensureHealth();
    expect(second).toBe(first);
    expect(health).toHaveBeenCalledTimes(1);

    pending.resolve({ available: true });
    await first;
    expect(useTtsStore.getState().available).toBe(true);
  });

  it('retries health after an unavailable response', async () => {
    health.mockResolvedValueOnce({ available: false });
    health.mockResolvedValueOnce({ available: true });

    await useTtsStore.getState().ensureHealth();
    expect(useTtsStore.getState().available).toBe(false);
    await useTtsStore.getState().ensureHealth();

    expect(health).toHaveBeenCalledTimes(2);
    expect(useTtsStore.getState().available).toBe(true);
  });

  it('retries health after a network error', async () => {
    health.mockRejectedValueOnce(new Error('offline'));
    health.mockResolvedValueOnce({ available: true });

    await useTtsStore.getState().ensureHealth();
    expect(useTtsStore.getState().available).toBe(false);
    await useTtsStore.getState().ensureHealth();

    expect(health).toHaveBeenCalledTimes(2);
    expect(useTtsStore.getState().available).toBe(true);
  });
});

describe('startup greeting playback', () => {
  /** Minimal document stand-in: node has no DOM, but the store needs the events. */
  function stubDocument() {
    const listeners = new Map<string, Set<EventListener>>();
    vi.stubGlobal('document', {
      addEventListener: (type: string, fn: EventListener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: EventListener) => {
        listeners.get(type)?.delete(fn);
      },
    });
    return {
      fire: (type: string) => {
        for (const fn of [...(listeners.get(type) ?? [])]) {
          fn(new Event(type));
        }
      },
      listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
    };
  }

  it('waits for a gesture instead of reporting a failure when autoplay is blocked', async () => {
    const doc = stubDocument();
    synth.mockResolvedValue(new Blob(['wav']));
    FakeAudio.blockedPlays = 1;

    await useTtsStore.getState().speak('__startup-greeting__', 'Good evening, Dinesh.', {
      deferUntilGesture: true,
    });

    // Nothing played yet, but the failure is not the user's to fix either.
    expect(FakeAudio.instances[0].playCalls).toBe(1);
    expect(useTtsStore.getState().state).toBe('idle');
    expect(useTtsStore.getState().error).toBeNull();
    expect(doc.listenerCount('pointerdown')).toBe(1);

    doc.fire('pointerdown');
    // The retry resolves on a microtask; let it land before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(FakeAudio.instances[0].playCalls).toBe(2);
    expect(useTtsStore.getState().state).toBe('speaking');
    expect(useTtsStore.getState().speakingId).toBe('__startup-greeting__');
    // The listener is one-shot: a second click must not restart the line.
    expect(doc.listenerCount('pointerdown')).toBe(0);
  });

  it('still reports a blocked reply, which follows a click and should have played', async () => {
    stubDocument();
    synth.mockResolvedValue(new Blob(['wav']));
    FakeAudio.blockedPlays = 1;

    await useTtsStore.getState().speak('m1', 'Hello');

    expect(useTtsStore.getState().error).toBeTruthy();
    expect(useTtsStore.getState().errorId).toBe('m1');
  });

  it('leaves no gesture listener behind when the user stops it first', async () => {
    const doc = stubDocument();
    synth.mockResolvedValue(new Blob(['wav']));
    FakeAudio.blockedPlays = 1;

    await useTtsStore.getState().speak('__startup-greeting__', 'Good evening.', {
      deferUntilGesture: true,
    });
    expect(doc.listenerCount('pointerdown')).toBe(1);

    useTtsStore.getState().stop();

    expect(doc.listenerCount('pointerdown')).toBe(0);
  });
});

describe('autoplay gating', () => {
  it('stays silent when a finished conversation is merely restored', () => {
    expect(
      shouldAutoplayFinishedReply(null, 'chat-1', false, { role: 'assistant', id: 'old' }, null),
    ).toBe(false);
  });

  it('speaks when a stream finishes', () => {
    expect(
      shouldAutoplayFinishedReply('chat-1', 'chat-1', false, { role: 'assistant', id: 'fresh' }, null),
    ).toBe(true);
  });

  it('stays silent while the reply is still streaming', () => {
    expect(
      shouldAutoplayFinishedReply('chat-1', 'chat-1', true, { role: 'assistant', id: 'fresh' }, null),
    ).toBe(false);
  });

  it('never repeats a message it already spoke', () => {
    expect(
      shouldAutoplayFinishedReply('chat-1', 'chat-1', false, { role: 'assistant', id: 'fresh' }, 'fresh'),
    ).toBe(false);
  });

  it('ignores a trailing user message', () => {
    expect(
      shouldAutoplayFinishedReply('chat-1', 'chat-1', false, { role: 'user', id: 'u1' }, null),
    ).toBe(false);
  });

  it('does not speak an old reply when the user switches conversations mid-stream', () => {
    expect(
      shouldAutoplayFinishedReply('chat-1', 'chat-2', true, { role: 'assistant', id: 'old' }, null),
    ).toBe(false);
  });
});

interface VoicePresetSelectProps {
  /** Voice catalog reported by the active TTS backend. */
  voices: string[];
  /** Chosen voice; empty means "use whatever the server is configured with". */
  value: string;
  /** Voice the server would use for an empty `value`, from config.toml. */
  serverVoice?: string;
  /** False once the catalog is known to be empty, so the select is inert. */
  ready: boolean;
  onChange: (voice: string) => void;
}

/**
 * Dropdown over the active backend's voice catalog.
 *
 * Voice IDs are backend-specific -- Phonon names voices ("Bryony"), Kokoro uses
 * IDs ("bm_george") -- so the catalog is always fetched rather than hardcoded.
 * A backend without an enumerable catalog still gets a single option showing
 * the configured voice, instead of an empty control that looks broken.
 */
export function VoicePresetSelect({
  voices,
  value,
  serverVoice,
  ready,
  onChange,
}: VoicePresetSelectProps) {
  const selected = value || serverVoice || '';

  return (
    <select
      value={selected}
      onChange={(e) => onChange(e.target.value)}
      disabled={!ready || voices.length === 0}
      aria-label="Voice"
      className="px-3 py-1.5 rounded-lg text-xs cursor-pointer disabled:cursor-default"
      style={{
        background: 'var(--color-bg-secondary)',
        color: 'var(--color-text)',
        border: '1px solid var(--color-border)',
        maxWidth: '220px',
        opacity: ready && voices.length > 0 ? 1 : 0.5,
      }}
    >
      {voices.length === 0 && <option value={selected}>{selected || 'Default'}</option>}
      {voices.map((voice) => (
        <option key={voice} value={voice}>
          {voice}
        </option>
      ))}
    </select>
  );
}
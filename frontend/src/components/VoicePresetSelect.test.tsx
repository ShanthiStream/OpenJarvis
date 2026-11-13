import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { VoicePresetSelect } from './VoicePresetSelect';

/** SSR marks the selected option instead of writing a `value` on <select>. */
function selectedOption(html: string): string {
  return html.match(/<option value="([^"]*)" selected=""/)?.[1] ?? '';
}

describe('voice preset dropdown', () => {
  it('lists every voice the backend reports', () => {
    const html = renderToStaticMarkup(
      <VoicePresetSelect
        voices={['Alfie', 'Bryony', 'Zoey']}
        value=""
        serverVoice="Bryony"
        ready
        onChange={vi.fn()}
      />,
    );

    for (const voice of ['Alfie', 'Bryony', 'Zoey']) {
      expect(html).toContain(`<option value="${voice}"`);
    }
    expect(html).not.toContain(' disabled=""');
  });

  it("shows the server's configured voice while nothing is chosen", () => {
    const html = renderToStaticMarkup(
      <VoicePresetSelect
        voices={['Alfie', 'Bryony']}
        value=""
        serverVoice="Bryony"
        ready
        onChange={vi.fn()}
      />,
    );

    // A chosen-but-empty voice resolves to the server default, so the control
    // never sits on a value its own list does not contain.
    expect(selectedOption(html)).toBe('Bryony');
  });

  it('selects the explicitly chosen voice over the server default', () => {
    const html = renderToStaticMarkup(
      <VoicePresetSelect
        voices={['Alfie', 'Bryony']}
        value="Alfie"
        serverVoice="Bryony"
        ready
        onChange={vi.fn()}
      />,
    );

    expect(selectedOption(html)).toBe('Alfie');
  });

  it('degrades to the configured voice when the backend has no catalog', () => {
    const html = renderToStaticMarkup(
      <VoicePresetSelect voices={[]} value="" serverVoice="onyx" ready onChange={vi.fn()} />,
    );

    expect(html).toContain('<option value="onyx"');
    expect(html).toContain(' disabled=""');
  });

  it('stays inert until the catalog has loaded', () => {
    const html = renderToStaticMarkup(
      <VoicePresetSelect voices={[]} value="" ready={false} onChange={vi.fn()} />,
    );

    expect(html).toContain('<option value=""');
    expect(html).toContain('Default');
    expect(html).toContain(' disabled=""');
  });
});
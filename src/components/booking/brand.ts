// The hotel's look on the guest pages: heading face, colours as CSS
// variables (--be-primary, --be-on-primary, --be-soft, --be-accent,
// --be-on-accent, --be-accent-text). Fonts are self-hosted and only the
// letters a page uses are downloaded (unicode-range subsets).
import type { CSSProperties } from 'react';
import '@fontsource-variable/newsreader/index.css';
import '@fontsource-variable/manrope/index.css';
import './booking.css';
import { brandColors, type EngineTheme } from '@/lib/bookingEngine/logic';

export function headingClassFor(style: EngineTheme['style'] | undefined): string {
  return style === 'modern' ? 'be-heading-modern' : 'be-heading-classic';
}

export function brandStyle(theme: EngineTheme | undefined | null): CSSProperties {
  const c = brandColors(theme?.primary, theme?.accent);
  return {
    '--be-primary': c.primary,
    '--be-on-primary': c.onPrimary,
    '--be-soft': c.soft,
    '--be-accent': c.accent,
    '--be-on-accent': c.onAccent,
    '--be-accent-text': c.accentText,
  } as CSSProperties;
}

/** Only https images (or same-site paths) are shown; anything else is ignored. */
export function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Font resolution for the prescription templates.
 *
 * A saved `fontFamily` is a CSS *stack* ("Poppins, sans-serif"), not a family
 * name. Templates that interpolate it straight into `font-family: '...'` end up
 * quoting the whole stack as one family, which matches nothing and silently
 * falls back — so the selected font never applies. Use `getPrimaryFont` for CSS
 * and `buildFontUrl` for the stylesheet href, never the raw stack.
 */

const DEFAULT_FONT_STACK = 'Inter, sans-serif';

/** Weights the templates actually use (body, medium, semibold, bold). */
const FONT_WEIGHTS = '400;500;600;700';

/**
 * Families that are not on Google Fonts. Requesting them returns a 400 for the
 * whole stylesheet, taking every other family in the same request down with it.
 */
const NON_GOOGLE_FONTS = new Set(['graphik']);

/** The bare family name, safe to quote in a CSS `font-family` declaration. */
export const getPrimaryFont = (fontFamily?: string | null): string =>
  (fontFamily || DEFAULT_FONT_STACK).split(',')[0].trim().replace(/['"]/g, '');

/**
 * A Google Fonts href for the selected family, with spaces encoded (`Open Sans`
 * → `Open+Sans`) and explicit weights. Returns an empty string for families
 * Google does not host, so the template renders no dead `<link>`.
 */
export const buildFontUrl = (fontFamily?: string | null): string => {
  const primaryFont = getPrimaryFont(fontFamily);

  if (!primaryFont || NON_GOOGLE_FONTS.has(primaryFont.toLowerCase())) {
    return '';
  }

  const family = `${primaryFont.replace(/\s+/g, '+')}:wght@${FONT_WEIGHTS}`;

  return `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
};

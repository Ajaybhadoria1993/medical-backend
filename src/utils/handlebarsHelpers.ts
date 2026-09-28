import handlebars from 'handlebars';

/**
 * Shared Handlebars helpers for the prescription/report templates, imported for
 * side effects by every render path so templates can rely on them.
 */

/**
 * Coerces a template argument to a string. Two non-strings reach these helpers:
 * numeric clinic columns (`zip_code` is an integer), and Handlebars' own
 * options object when a template passes fewer arguments than declared. Either
 * used to throw, aborting the render and leaving `prescription_pdf` null.
 */
const toText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  // Handlebars options object (or any other object) — nothing useful to print.
  return '';
};

/** Normalized form used only for comparison, never for output. */
const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[.,\-|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Countries dropped from a clinic address line. A prescription is handed to a
 * patient standing in the clinic — the country is never useful, and it is the
 * single most common trailing segment in stored addresses.
 */
const COUNTRY_NAMES = new Set(['india', 'bharat']);

/** Indian PIN codes are 6 digits; 5 covers the odd legacy/foreign entry. */
const POSTAL_CODE = /\b\d{5,6}\b/g;

/** Strips a phrase wherever it appears, ignoring case and punctuation spacing. */
const removePhrase = (segment: string, phrase: string): string => {
  const trimmed = phrase.trim();
  if (!trimmed) return segment;

  return segment.replace(
    new RegExp(escapeRegex(trimmed).replace(/\s+/g, '\\s+'), 'gi'),
    ' '
  );
};

const tidy = (segment: string): string =>
  segment
    .replace(/\s+/g, ' ')
    .replace(/^[\s,\-–]+|[\s,\-–]+$/g, '')
    .trim();

/**
 * Builds the prescription letterhead address line: street and locality/city
 * only. State, postal code and country are dropped because clinics routinely
 * fill both the free-text address and the city/state/zipcode columns, which
 * produced a duplicated two-line address that broke alignment. `state` and
 * `zipcode` are still taken so they can be stripped from the free-text address.
 */
export const formatClinicAddress = (
  address?: unknown,
  city?: unknown,
  state?: unknown,
  zipcode?: unknown
): string => {
  const stateValue = toText(state).trim();
  const zipValue = toText(zipcode).trim();

  const parts = toText(address)
    .split(',')
    .map((segment) => {
      let cleaned = segment;

      if (zipValue) cleaned = removePhrase(cleaned, zipValue);
      cleaned = cleaned.replace(POSTAL_CODE, ' ');
      if (stateValue) cleaned = removePhrase(cleaned, stateValue);

      return tidy(cleaned);
    })
    .filter((segment) => segment && !COUNTRY_NAMES.has(normalize(segment)));

  const cityValue = tidy(toText(city));

  if (
    cityValue &&
    !COUNTRY_NAMES.has(normalize(cityValue)) &&
    !parts.some((segment) => normalize(segment) === normalize(cityValue))
  ) {
    parts.push(cityValue);
  }

  return parts.join(', ');
};

handlebars.registerHelper(
  'clinicAddress',
  (address?: unknown, city?: unknown, state?: unknown, zipcode?: unknown) =>
    formatClinicAddress(address, city, state, zipcode)
);

/**
 * Short form prefix for the medication line ("Tab. Paracip 500", "Inj.
 * Ceftriaxone") — the standard abbreviations used on real prescriptions for
 * forms that have one; everything else falls back to the form's own name
 * rather than inventing a non-standard shorthand.
 */
const FORM_ABBREVIATIONS: Record<string, string> = {
  tablet: 'Tab.',
  capsule: 'Cap.',
  injection: 'Inj.',
  syrup: 'Syr.',
  suspension: 'Susp.',
  lozenge: 'Loz.',
  sachet: 'Sach.',
  granules: 'Gran.',
  powder: 'Powd.',
  ointment: 'Oint.',
  suppository: 'Supp.',
};

const titleCase = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');

export const getMedicineFormPrefix = (form?: unknown): string => {
  const normalized = toText(form).trim().toLowerCase();
  if (!normalized) return '';

  // A variant ("effervescent tablet", "oral suspension") takes its base form's abbreviation.
  const baseForm = normalized
    .split(/\s+/)
    .reverse()
    .find((word) => FORM_ABBREVIATIONS[word]);

  return (
    FORM_ABBREVIATIONS[normalized] ||
    (baseForm ? FORM_ABBREVIATIONS[baseForm] : titleCase(normalized))
  );
};

handlebars.registerHelper('formPrefix', (form?: unknown) =>
  getMedicineFormPrefix(form)
);

/** `{{addOne @index}}` — 1-based row numbers from Handlebars' 0-based `@index`. */
handlebars.registerHelper('addOne', (value: number) => value + 1);

handlebars.registerHelper(
  'default',
  (value: unknown, defaultValue: string) => value || defaultValue
);

handlebars.registerHelper('split', (str: unknown, separator: string) => {
  if (!str) return [];

  return String(str)
    .split(separator)
    .map((s) => s.trim())
    .filter((s) => s);
});

handlebars.registerHelper('medicineNameWithOr', (value: unknown) => {
  const parts = String(value ?? '').split(/(\s+or\s+)/i);
  const rendered = parts
    .map((part, index) => {
      const escapedPart = handlebars.escapeExpression(part);
      if (index % 2 === 0) return escapedPart;

      const separator = part.trim();
      const separatorStart = part.indexOf(separator);
      const leadingSpace = part.slice(0, separatorStart);
      const trailingSpace = part.slice(separatorStart + separator.length);

      return `${handlebars.escapeExpression(leadingSpace)}<span style="color: var(--color1);">${handlebars.escapeExpression(separator)}</span>${handlebars.escapeExpression(trailingSpace)}`;
    })
    .join('');

  return new handlebars.SafeString(rendered);
});

/**
 * True when a value is real content — not empty, and not a placeholder ("N/A",
 * "-"). Those columns are NOT NULL with placeholders rather than nulls, so a
 * plain `{{#if this.composition}}` is always truthy and prints "Composition:
 * N/A" on every medicine that never had one.
 */
export const hasMeaningfulValue = (value: unknown): boolean => {
  const text = toText(value).trim();
  if (!text) return false;
  const normalized = text.toLowerCase();
  return normalized !== 'n/a' && normalized !== '-';
};

handlebars.registerHelper('hasValue', (value: unknown) =>
  hasMeaningfulValue(value)
);

/**
 * True when at least one argument is real content — arrays by length, the rest
 * by `hasMeaningfulValue`. Lets a side rail collapse: it reserves a fixed share
 * of the width, so with every block inside it empty the layout was left with a
 * blank column beside a squeezed medication table.
 */
handlebars.registerHelper('anyValue', (...callArgs: unknown[]) =>
  callArgs.slice(0, -1).some((value) => {
    // Booleans are flags (`vitalsMoreThanOne`), so they count as themselves.
    // Without this `false` stringifies to "false" and reads as content.
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') {
      return Object.keys(value as Record<string, unknown>).length > 0;
    }
    return hasMeaningfulValue(value);
  })
);

/**
 * The value when its section is switched on, nothing when off. For the
 * collapsing side rail: its guard must weigh each block's data and the doctor's
 * visibility toggle together, or a rail with every card switched off still
 * claims its width.
 */
handlebars.registerHelper('whenShown', (isShown: unknown, value: unknown) =>
  isShown ? value : undefined
);

/**
 * Joins several dose fields with a separator, dropping any that are empty or
 * a placeholder ("-", "N/A") instead of printing the placeholder inline —
 * `{{joinValues this.dosage this.frequency this.duration " · "}}` prints
 * "5 Days" for a medicine with no dosage/frequency set, not "- · - · 5 Days".
 */
handlebars.registerHelper('joinValues', (...callArgs: unknown[]) => {
  const args = callArgs.slice(0, -1); // drop Handlebars' trailing options object
  const separator = toText(args.pop());
  return args.filter(hasMeaningfulValue).map(toText).join(separator);
});

/** The three dose slots a `"1-0-1"` frequency string encodes, in order. */
const DOSE_SLOT_LABELS = ['Morning', 'Afternoon', 'Night'] as const;

/**
 * Splits a `"1-1-1"`-style frequency into `[{ label, count }, ...]` for labelled
 * Morning/Afternoon/Night rows. Zero-dose slots are dropped ("Afternoon 0" is
 * noise). Anything that isn't three dash-separated tokens (a placeholder, or
 * free text like "SOS") returns an empty array, which `{{#if}}` treats as falsy
 * so the template can print the frequency as written.
 */
export const parseDoseSlots = (
  frequency?: unknown
): Array<{ label: string; count: string; isNight: boolean }> => {
  const text = toText(frequency).trim();
  if (!hasMeaningfulValue(text)) return [];

  const parts = text.split('-').map((part) => part.trim());
  if (parts.length !== DOSE_SLOT_LABELS.length) return [];

  // Every token must be a dose amount ("1", "0", "2", "1/2", "0.5").
  const isDose = (part: string) => /^\d+(?:[./]\d+)?$/.test(part);
  if (!parts.every(isDose)) return [];

  return parts
    .map((count, index) => ({
      label: DOSE_SLOT_LABELS[index],
      count,
      // Carried on the slot so a template can pick a sun/moon icon with a plain
      // `{{#if this.isNight}}` instead of needing a string-compare helper.
      isNight: DOSE_SLOT_LABELS[index] === 'Night',
    }))
    .filter((slot) => parseFloat(slot.count) > 0);
};

handlebars.registerHelper('doseSlots', (frequency?: unknown) =>
  parseDoseSlots(frequency)
);

/**
 * Turns the free-form `additionalInformation` map into `[{key, value}, ...]` so
 * a template can `{{#each}}` it — Handlebars cannot iterate a plain object's
 * entries. Empty/placeholder entries are dropped so they don't print a bullet.
 */
handlebars.registerHelper('objectEntries', (obj: unknown) => {
  if (!obj || typeof obj !== 'object') return [];

  return Object.entries(obj as Record<string, unknown>)
    .filter(([, value]) => hasMeaningfulValue(value))
    .map(([key, value]) => ({ key, value: toText(value) }));
});

/** Shape of `i18n` on the render data; built by PrescriptionTranslationService.buildI18n. */
type BilingualContext = {
  lang?: string;
  collect?: Set<string>;
  map?: Record<string, string>;
  bilingual?: boolean;
};

/** English with the translation under it, or the translation alone when `bilingual` is false. */
const renderTranslation = (
  text: string,
  translated: string,
  i18n: BilingualContext
) => {
  const lang = handlebars.escapeExpression(i18n.lang ?? '');
  const regionalOnly = i18n.bilingual === false;
  // Phrase keys drop a trailing colon, so put it back to match the English labels beside it.
  const withColon =
    /:\s*$/.test(text) && !/[:：]\s*$/.test(translated)
      ? `${translated}:`
      : translated;
  const span = `<span class="${regionalOnly ? 'tr-only' : 'tr'}" lang="${lang}" dir="auto">${handlebars.escapeExpression(withColon)}</span>`;
  return new handlebars.SafeString(
    regionalOnly ? span : `${handlebars.escapeExpression(text)}${span}`
  );
};

/** `{{bi value}}` prints English exactly as before; with `i18n` set, the translation follows (or replaces it when `bilingual` is false).
 * The collecting render only records the text, so the translated set is exactly what the template prints. */
handlebars.registerHelper(
  'bi',
  (value: unknown, options: handlebars.HelperOptions) => {
    const text = toText(value);
    const i18n = options?.data?.root?.i18n as BilingualContext | undefined;
    if (!i18n || !text.trim()) return text;

    if (i18n.collect) {
      i18n.collect.add(text);
      return text;
    }

    const translated = i18n.map?.[text];
    return translated ? renderTranslation(text, translated, i18n) : text;
  }
);

/** `{{biJoin a b " - "}}`: `joinValues`, but each part is translated on its own so dictionary phrases still match.
 * A part with no translation stays English inside the translated line. */
handlebars.registerHelper('biJoin', (...callArgs: unknown[]) => {
  const options = callArgs.pop() as handlebars.HelperOptions;
  const separator = toText(callArgs.pop());
  const parts = callArgs.filter(hasMeaningfulValue).map(toText);
  const text = parts.join(separator);
  const i18n = options?.data?.root?.i18n as BilingualContext | undefined;
  if (!i18n || !text.trim()) return text;

  if (i18n.collect) {
    parts.forEach((part) => i18n.collect?.add(part));
    return text;
  }

  const translatedParts = parts.map((part) => i18n.map?.[part] ?? part);
  return translatedParts.every((part, i) => part === parts[i])
    ? text
    : renderTranslation(text, translatedParts.join(separator), i18n);
});

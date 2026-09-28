/** The doctor's own instruction phrases, keyed by medicine form. */
export type InstructionSuggestionMap = Record<string, string[]>;

/** Form keys match the frontend's lookup: trimmed and lower-cased. */
const toFormKey = (form: string) => form.trim().toLowerCase();

/** Trimmed, blank-free and unique ignoring case, keeping the doctor's order. */
const cleanPhrases = (phrases: string[]) => {
  const seen = new Set<string>();

  return phrases
    .map((phrase) => phrase.trim())
    .filter((phrase) => {
      const key = phrase.toLowerCase();
      if (!phrase || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

/** Applies a per-form update: each incoming form replaces only that form, and an empty list removes it. */
export function mergeInstructionSuggestions(
  stored: InstructionSuggestionMap | null | undefined,
  incoming: InstructionSuggestionMap
): InstructionSuggestionMap {
  const merged: InstructionSuggestionMap = {};

  for (const [form, phrases] of Object.entries(stored ?? {})) {
    merged[toFormKey(form)] = phrases;
  }

  for (const [form, phrases] of Object.entries(incoming)) {
    const key = toFormKey(form);
    if (!key) continue;

    const cleaned = cleanPhrases(phrases);
    if (cleaned.length > 0) merged[key] = cleaned;
    else delete merged[key];
  }

  return merged;
}

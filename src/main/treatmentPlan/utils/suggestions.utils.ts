import type { ActiveTemplate } from '../types/template.types';

export interface TemplateMatch {
  template: ActiveTemplate;
  /** The keyword found in the diagnosis, shown to the doctor as the reason. */
  matchedKeyword: string;
}

const normalise = (text: string) =>
  text.toLowerCase().replace(/\s+/g, ' ').trim();
const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Templates whose diagnosis keywords appear in the diagnosis as whole words, best first:
 *  the longest (most specific) keyword wins; ties go to the doctor's own version, then A–Z. */
export function matchTemplates(
  diagnosis: string,
  templates: ActiveTemplate[],
  limit = 4
): TemplateMatch[] {
  const text = normalise(diagnosis);
  if (!text) return [];
  const matches: TemplateMatch[] = [];
  for (const template of templates) {
    const hit = template.diagnosisKeywords
      .map(normalise)
      .filter(
        (k) => k && new RegExp(`(^|\\W)${escapeRegex(k)}($|\\W)`).test(text)
      )
      .sort((a, b) => b.length - a.length)[0];
    if (hit) matches.push({ template, matchedKeyword: hit });
  }
  return matches
    .sort(
      (a, b) =>
        b.matchedKeyword.length - a.matchedKeyword.length ||
        Number(b.template.ownerDoctorId !== null) -
          Number(a.template.ownerDoctorId !== null) ||
        a.template.name.localeCompare(b.template.name)
    )
    .slice(0, limit);
}

/**
 * Derives a plan-feature key from a display name. Only used when creating a
 * feature — an existing key is never re-derived, since the limitation engine
 * looks limits up by key (see FEATURE_KEYS).
 */
export const toFeatureKey = (displayName: string): string =>
  displayName
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

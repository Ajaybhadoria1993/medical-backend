/** `q` safe inside LIKE/ILIKE: `\`, `%` and `_` match literally. */
export const escapeLike = (q: string): string => q.replace(/[\\%_]/g, '\\$&');

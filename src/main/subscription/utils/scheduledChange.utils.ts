/** Over-limit accounts to switch off: the ones the Admin did not ask to keep go first. */
export const pickToDeactivate = (
  users: { id: string }[],
  excess: number,
  keepIds: string[]
): string[] => {
  if (excess <= 0) return [];
  const keep = new Set(keepIds);
  return [
    ...users.filter((u) => !keep.has(u.id)),
    ...users.filter((u) => keep.has(u.id)),
  ]
    .slice(0, excess)
    .map((u) => u.id);
};

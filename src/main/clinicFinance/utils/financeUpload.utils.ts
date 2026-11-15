export function financeEvidenceKey(
  clinicId: string,
  disputeId: string,
  originalName: string
): string {
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `clinic_finance/${clinicId}/disputes/${disputeId}/${Date.now()}-${safeName}`;
}

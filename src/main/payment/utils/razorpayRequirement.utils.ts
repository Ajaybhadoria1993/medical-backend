/** One Razorpay KYC requirement as a line a clinic can act on, e.g. "bank IFSC code: invalid". */
export const formatRazorpayRequirement = (requirement: any) => {
  const reference = String(
    requirement?.field_reference || requirement?.field || 'KYC details'
  );
  const field = reference.split('.').pop()?.toLowerCase() || 'KYC details';
  const fieldLabels: Record<string, string> = {
    legal_business_name: 'legal business name',
    business_type: 'business type',
    stakeholder_name: 'stakeholder name',
    stakeholder_email: 'stakeholder email',
    stakeholder_phone: 'stakeholder phone',
    stakeholder_pan: 'stakeholder PAN',
    gstin: 'GSTIN',
    beneficiary_name: 'bank account holder name',
    account_number: 'bank account number',
    ifsc_code: 'bank IFSC code',
    bank_account_type: 'bank account type',
    registered_address: 'registered address',
    postal_code: 'postal code',
    individual_proof_of_identification: 'personal PAN document',
    individual_proof_of_address: 'stakeholder address proof',
    business_proof_of_identification: 'business identity document',
    personal_pan: 'personal PAN document',
    business_pan_url: 'business PAN document',
    aadhar_front: 'Aadhaar front image',
    aadhar_back: 'Aadhaar back image',
    passport_front: 'passport front image',
    passport_back: 'passport back image',
    voter_id_front: 'voter ID front image',
    voter_id_back: 'voter ID back image',
  };
  const label = fieldLabels[field] || field.replace(/_/g, ' ');
  const reason = requirement?.description || requirement?.reason;
  return reason ? `${label}: ${reason}` : label;
};

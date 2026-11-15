/** A clinic as billing needs it: who it is and how to reach its owner. */
export interface BillingClinic {
  name: string | null;
  code: string | null;
  phone: string | null;
  ownerUserId: string | null;
}

/** The clinic's postal details printed on an invoice; state decides CGST + SGST or IGST. */
export interface BillingParty {
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/** What the subscription module reads about clinics; implemented in src/adapters/subscription. */
export interface ClinicPort {
  /** Clinics by id; ids with no clinic are left out. */
  getClinics(clinicIds: string[]): Promise<Map<string, BillingClinic>>;
  /** The invoice's bill-to details, or null when the clinic does not exist. */
  getBillingParty(clinicId: string): Promise<BillingParty | null>;
  /** Owner email and a phone (the clinic's, else the owner's) for Razorpay; null when either is missing. */
  getOwnerContact(
    clinicId: string
  ): Promise<{ email: string; phone: string } | null>;
  /** True once a Super Admin has approved the clinic (its owner account is Active). */
  isApproved(clinicId: string): Promise<boolean>;
}

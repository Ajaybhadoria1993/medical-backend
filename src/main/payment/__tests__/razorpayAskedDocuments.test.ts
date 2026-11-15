import { razorpayAskedDocuments as asked } from '../utils/payoutAccount.utils';

const req = (field_reference: string, status = 'required') => ({
  field_reference,
  status,
  reason_code: 'document_missing',
});
const types = (r: ReturnType<typeof asked>) => r.map((d) => d.documentType);

describe('razorpayAskedDocuments', () => {
  it('nothing asked: no documents (Route needs details only)', () => {
    expect(asked([], 'individual')).toEqual([]);
  });

  it('a cheque ask shows only the cheque, with why', () => {
    const r = asked([req('settlements.cancelled_cheque')], 'individual');
    expect(types(r)).toEqual(['cancelled_cheque']);
    expect(r[0]).toMatchObject({
      required: true,
      description: expect.stringContaining('IFSC'),
    });
  });

  it('an address-proof ask shows both Aadhaar sides as required', () => {
    const r = asked([req('individual_proof_of_address')], 'individual');
    expect(types(r)).toEqual(['aadhar_front', 'aadhar_back']);
    expect(r.every((d) => d.required)).toBe(true);
  });

  it('a requirement already met is ignored', () => {
    expect(
      asked([req('settlements.cancelled_cheque', 'submitted')], 'individual')
    ).toEqual([]);
  });
});

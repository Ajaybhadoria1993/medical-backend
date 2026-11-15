import { financialYearOf } from '../../../utils/financialYear';
import { gstStateCodeOf } from '../../../utils/gstStateCode';
import {
  applyTax,
  gstLabel,
  gstSplit,
  gstSplitOf,
  invoiceNumber,
} from '../utils/invoiceTax.utils';

describe('applyTax', () => {
  it('takes 18% out of an inclusive ₹499', () => {
    expect(applyTax(49900, { rateBp: 1800, mode: 'inclusive' })).toEqual({
      subtotalPaise: 42288,
      taxPaise: 7612,
      totalPaise: 49900,
    });
  });

  it('adds 18% on top of an exclusive ₹499', () => {
    expect(applyTax(49900, { rateBp: 1800, mode: 'exclusive' })).toEqual({
      subtotalPaise: 49900,
      taxPaise: 8982,
      totalPaise: 58882,
    });
  });

  it('adds nothing when GST is off', () => {
    expect(applyTax(49900, { rateBp: 0, mode: 'none' })).toEqual({
      subtotalPaise: 49900,
      taxPaise: 0,
      totalPaise: 49900,
    });
  });
});

describe('gstLabel', () => {
  const gst18 = { rateBp: 1800, mode: 'exclusive' as const };
  it('words the split exactly like the invoice', () => {
    expect(gstLabel(gst18, gstSplitOf('23', '23'))).toBe(
      'GST 18% (CGST 9% + SGST 9%)'
    );
    expect(gstLabel(gst18, gstSplitOf('27', '23'))).toBe('GST 18% (IGST)');
    expect(gstLabel({ rateBp: 500, mode: 'exclusive' }, 'cgst_sgst')).toBe(
      'GST 5% (CGST 2.5% + SGST 2.5%)'
    );
  });
});

describe('gstSplit', () => {
  it('splits ₹499 inside Madhya Pradesh into CGST + SGST', () => {
    expect(gstSplit(49900, true)).toEqual({
      taxablePaise: 42288,
      cgstPaise: 3806,
      sgstPaise: 3806,
      igstPaise: 0,
      totalPaise: 49900,
    });
  });

  it('charges IGST outside the state', () => {
    const s = gstSplit(49900, false);
    expect(s).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 7612 });
  });

  it('always adds up, odd paise included', () => {
    for (const total of [0, 1, 99, 25001, 959000]) {
      const s = gstSplit(total, true);
      expect(s.taxablePaise + s.cgstPaise + s.sgstPaise + s.igstPaise).toBe(
        total
      );
    }
  });

  it('splits an exclusive charge at its own rate', () => {
    // ₹499 + 12% = ₹558.88 charged; the invoice takes the 12% back out.
    expect(
      gstSplit(55888, false, { rateBp: 1200, mode: 'exclusive' })
    ).toMatchObject({
      taxablePaise: 49900,
      igstPaise: 5988,
    });
  });

  it('has no GST lines when GST is off', () => {
    expect(gstSplit(49900, true, { rateBp: 0, mode: 'none' })).toEqual({
      taxablePaise: 49900,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      totalPaise: 49900,
    });
  });
});

describe('invoice numbering', () => {
  it('formats the number', () => {
    expect(invoiceNumber('IMS', '2026-27', 1)).toBe('IMS/26-27/0001');
    expect(invoiceNumber('IMS', '2026-27', 10000)).toBe('IMS/26-27/10000');
    expect(invoiceNumber('IMS', '2026-27', 999999).length).toBeLessThanOrEqual(
      16
    );
  });

  it('switches financial year at midnight IST on 1 April', () => {
    expect(financialYearOf(new Date('2027-03-31T18:29:59Z'))).toBe('2026-27');
    expect(financialYearOf(new Date('2027-03-31T18:30:00Z'))).toBe('2027-28');
  });
});

describe('gstStateCodeOf', () => {
  it('maps state names to GST codes', () => {
    expect(gstStateCodeOf(' Madhya  Pradesh ')).toBe('23');
    expect(gstStateCodeOf('Maharashtra')).toBe('27');
    expect(gstStateCodeOf('Atlantis')).toBeNull();
  });
});

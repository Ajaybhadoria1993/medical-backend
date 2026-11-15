import { rupeesInWords } from '../utils/invoiceTax.utils';

describe('rupeesInWords', () => {
  it('writes amounts the Indian way', () => {
    expect(rupeesInWords(19900)).toBe('Rupees One Hundred Ninety Nine Only');
    expect(rupeesInWords(16864)).toBe(
      'Rupees One Hundred Sixty Eight and Sixty Four Paise Only'
    );
    expect(rupeesInWords(1435400)).toBe(
      'Rupees Fourteen Thousand Three Hundred Fifty Four Only'
    );
    expect(rupeesInWords(1234567800)).toBe(
      'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only'
    );
    expect(rupeesInWords(0)).toBe('Rupees Zero Only');
  });
});

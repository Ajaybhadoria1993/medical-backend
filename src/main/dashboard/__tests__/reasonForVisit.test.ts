/**
 * Booking prepends "Token N requested (HH:MM session)" to appointmentNotes
 * (NewAppointment.tsx), which the dashboard used to show as the visit reason.
 */

import { resolveReasonForVisit } from '../services/dashboard.service';

describe('resolveReasonForVisit', () => {
  it('drops the token boilerplate and keeps what the user typed', () => {
    expect(
      resolveReasonForVisit(
        'Token 13 requested (09:00 session) - Severe back pain',
        null,
        'Consultation'
      )
    ).toBe('Severe back pain');
  });

  it('falls back to symptoms when the note is only boilerplate', () => {
    expect(
      resolveReasonForVisit(
        'Token 13 requested (09:00 session)',
        'Fever, Cough',
        'Consultation'
      )
    ).toBe('Fever, Cough');
  });

  it('falls back to the appointment type when nothing else is left', () => {
    expect(
      resolveReasonForVisit('Token 4 requested', null, 'Consultation')
    ).toBe('Consultation');
  });

  it('leaves a real note untouched', () => {
    expect(
      resolveReasonForVisit('Follow-up on blood report', null, 'Consultation')
    ).toBe('Follow-up on blood report');
  });

  it('does not eat a note that merely mentions a token', () => {
    expect(
      resolveReasonForVisit('Patient lost token 7 slip', null, 'Consultation')
    ).toBe('Patient lost token 7 slip');
  });
});

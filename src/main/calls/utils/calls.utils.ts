import type { CallStatus, CallView, ClinicCall } from '../types/calls.types';

export const CALL_RING_MS = 30_000;
/** How long an ended call stays readable, so the doctor sees the outcome. */
export const CALL_KEEP_SECONDS = 120;

export function resolveStatus(call: ClinicCall, now: number): CallStatus {
  if (call.status === 'ringing' && now >= Date.parse(call.expiresAt)) {
    return 'missed';
  }
  return call.status;
}

export function toCallView(call: ClinicCall, now: number): CallView {
  const { recipientIds: _r, declinedIds: _d, ...view } = call;
  const status = resolveStatus(call, now);
  return {
    ...view,
    status,
    endedAt: status === 'missed' ? call.expiresAt : call.endedAt,
  };
}

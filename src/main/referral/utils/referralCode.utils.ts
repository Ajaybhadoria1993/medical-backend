import { randomInt } from 'crypto';

export const REFERRAL_ROLES = ['Admin', 'Doctor'];

// No 0/O, 1/I/L: the code is read aloud and typed by hand.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PREFIX = 'MEDI-';
const LENGTH = 6;

/** A new random code, e.g. `MEDI-7KQ2XB`. Uniqueness is the DB's job. */
export const generateReferralCode = () =>
  PREFIX +
  Array.from(
    { length: LENGTH },
    () => ALPHABET[randomInt(ALPHABET.length)]
  ).join('');

/** What a user typed or pasted, in stored form. */
export const normalizeReferralCode = (code: string) =>
  code.trim().toUpperCase();

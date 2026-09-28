// src/main/mfa/schemas/mfa.schemas.ts
import { z } from 'zod';

export const verifyEnrollmentSchema = z.object({
  totpCode: z.string().regex(/^\d{6}$/, 'TOTP code must be exactly 6 digits'),
});

export const verifyLoginSchema = z.object({
  totpCode: z.string().regex(/^\d{6}$/, 'TOTP code must be exactly 6 digits'),
});

export const recoveryLoginSchema = z.object({
  recoveryCode: z
    .string()
    .regex(
      /^[a-zA-Z0-9]{8}$/,
      'Recovery code must be exactly 8 alphanumeric characters'
    ),
});

export const disableMfaSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

export const regenerateRecoverySchema = z.object({
  totpCode: z.string().regex(/^\d{6}$/, 'TOTP code must be exactly 6 digits'),
});

export type VerifyEnrollmentDto = z.infer<typeof verifyEnrollmentSchema>;
export type VerifyLoginDto = z.infer<typeof verifyLoginSchema>;
export type RecoveryLoginDto = z.infer<typeof recoveryLoginSchema>;
export type DisableMfaDto = z.infer<typeof disableMfaSchema>;
export type RegenerateRecoveryDto = z.infer<typeof regenerateRecoverySchema>;

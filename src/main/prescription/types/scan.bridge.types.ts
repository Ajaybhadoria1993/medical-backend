/** `cancelled`: the computer closed the session; kept only so the phone can say so. */
export type BridgeSessionStatus = 'waiting' | 'uploaded' | 'cancelled';

export type ScanBridgeUploadPayload = {
  imageBase64?: string | undefined;
  imageUrl?: string | undefined;
};

export type BridgeSession = {
  otp: string;
  status: BridgeSessionStatus;
  createdAt: number;
  uploadedAt?: number;
} & ScanBridgeUploadPayload;

export type BridgeUpdateResult =
  | { ok: true; session: BridgeSession }
  | {
      ok: false;
      reason: 'invalid_or_expired' | 'already_uploaded' | 'cancelled';
    };

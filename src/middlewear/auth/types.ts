// Types shared by the auth guards, plus the fields they attach to Express's Request.

// Minimal shape of JWT payload we sign in auth.service.ts
export type JwtPayload = {
  sub: string; // user id
  /** "View as" session id and the Super Admin acting; set only on support tokens. */
  sup?: string;
  act?: string;
  iat?: number;
  exp?: number;
};

// Minimal user shape attached to req
export interface AuthUser {
  id: string;
  email: string;
  userType:
    | 'Admin'
    | 'User'
    | 'Super_Admin'
    | 'Doctor'
    | 'Receptionist'
    | 'Nurse'
    | 'Pharmacist'
    | string;
  emailVerifiedAt?: string | null;
  userStatus?: 'Active' | 'Inactive' | string;
  isAdminDoctorAccess?: boolean;
  // add other fields you need (avoid sending password)
}

// augment Express Request to include `user`
declare module 'express-serve-static-core' {
  interface Request {
    user: AuthUser;
    clinicId: string;
    labId: string;
    /** Set when a Super Admin is in a read-only "View as" session as `user`. */
    supportSession?: { id: string; actorId: string };
  }
}

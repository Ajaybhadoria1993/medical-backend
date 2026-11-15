// Public surface of the module: code outside main/supportAccess imports only from here.
export { registerAccountPort, registerFilePort } from './ports';
export type { AccountPort, FilePort } from './ports';
export type {
  StaffMember,
  SupportTokenClaims,
} from './types/supportAccess.types';

/** Called by requireAuth for a "View as" token. Throws 403 on a write or a file route. */
export { enforceSupportSession } from './middlewares/supportSession.middleware';

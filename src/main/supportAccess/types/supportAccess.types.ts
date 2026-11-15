export interface StaffMember {
  id: string;
  name: string | null;
  email: string | null;
  userType: string;
  userStatus: string | null;
  emailVerifiedAt: Date | null;
}

/** Claims a "View as" access token carries on top of `sub` (the viewed user). */
export interface SupportTokenClaims {
  /** Session id. */
  sup: string;
  /** Super Admin acting. */
  act: string;
}

export interface StartSupportSessionInput {
  superAdminId: string;
  targetUserId: string;
  clinicId: string;
  reason: string;
}

export interface StartedSupportSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
  /** The Super Admin acting, shown in the View as tab's header. */
  actorName: string;
  /** Email masked; the tab shows who is being viewed. */
  user: StaffMember;
}

export interface SupportSessionItem {
  id: string;
  superAdminName: string;
  targetName: string;
  targetRole: string;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  endReason: string | null;
  pagesViewed: number;
}

export interface SupportSessionPage {
  items: SupportSessionItem[];
  pageNumber: number;
  pageSize: number;
  total: number;
}

/**
 * Socket.io room names, in one place.
 *
 * `user:` and `clinic:` already existed before the realtime bus and are
 * joined by socketManager on connect; they are re-exported here so every
 * emitter names a room the same way instead of building the string inline.
 *
 * The two `clinic:{c}:...` rooms are narrower targets added for the bus:
 * a signal about one doctor's queue should not wake the pharmacy and lab
 * screens that share the clinic room.
 */

export const rooms = {
  /** A single user's private room. */
  user: (userId: string): string => `user:${userId}`,

  /** Everyone assigned to the clinic. Broad — prefer a narrower room below. */
  clinic: (clinicId: string): string => `clinic:${clinicId}`,

  /** One doctor's queue: that doctor, plus the clinic's reception staff. */
  clinicDoctor: (clinicId: string, doctorId: string): string =>
    `clinic:${clinicId}:doctor:${doctorId}`,

  /**
   * Everyone in the clinic holding one role. `role` is the raw `userType`
   * from the user row (Doctor, Receptionist, Admin, Pharmacist, ...).
   */
  clinicRole: (clinicId: string, role: string): string =>
    `clinic:${clinicId}:role:${role}`,

  /**
   * Everyone assigned to one lab (`UserLabAssignmentsModel`) — narrower than
   * `clinic:{c}`, so a lab worklist update doesn't wake every clinic screen.
   * Not clinic-scoped in the room key itself: a lab belongs to one clinic,
   * but the assignment table is already the source of truth for membership.
   */
  lab: (labId: string): string => `lab:${labId}`,
};

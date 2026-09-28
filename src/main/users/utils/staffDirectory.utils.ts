import { StaffDirectoryRole } from '../types/staffDirectory.types';

// Single source of truth for both halves of the contract: it decides which
// joins and options the service builds, and is returned as availableFilters so
// the UI cannot render a filter the server would ignore.
//
// Department is deliberately absent for Lab_Assistant: lab_departments links a
// department to a lab, not to a person, so it cannot tell two assistants in the
// same lab apart. It needs a column on user_lab_assignments first.
// `lab`/`pharmacy` filters removed: a clinic has at most one of each, so
// filtering staff by which one they belong to has nothing to narrow.
export const ROLE_FILTERS: Record<StaffDirectoryRole, readonly string[]> = {
  Doctor: ['speciality', 'status'],
  Receptionist: ['assignedDoctor', 'location', 'status'],
  Nurse: ['assignedDoctor', 'location', 'status'],
  Lab_Assistant: ['status'],
  Pharmacist: ['location', 'status'],
};

const LIKE_SPECIAL_CHARACTERS = /[\\%_]/g;

export const escapeLike = (value: string): string =>
  value.replace(LIKE_SPECIAL_CHARACTERS, (char) => '\\' + char);

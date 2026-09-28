export type StaffAccessScope = 'assigned_doctors' | 'all_doctors';

export interface StaffScope {
  accessScope: StaffAccessScope;
  location: string | null;
  responsibility: string | null;
  doctorIds: string[];
  isDefault: boolean;
}

export interface ScopedDoctor {
  id: string;
  name: string | null;
  speciality: string | null;
  status: string | null;
}

export interface AssignedDoctorSummary {
  id: string;
  name: string | null;
  speciality: string | null;
}

export interface StaffAssignmentView {
  userId: string;
  name: string | null;
  email: string | null;
  userType: string;
  accessScope: StaffAccessScope;
  location: string | null;
  responsibility: string | null;
  isDefault: boolean;
  doctors: AssignedDoctorSummary[];
}

export interface DoctorStaffSummary {
  id: string;
  name: string | null;
  userType: string;
  location: string | null;
  viaAllDoctorsAccess: boolean;
}

export type StaffDirectoryRole =
  'Doctor' | 'Receptionist' | 'Nurse' | 'Lab_Assistant' | 'Pharmacist';

export interface StaffDirectoryBaseRow {
  id: string;
  name: string | null;
  email: string | null;
  mobile: string | null;
  profileImage: string | null;
  status: string | null;
  userType: string | null;
  isAdminDoctorAccess: boolean;
  isArchive: boolean;
  createdAt: Date | null;
}

export interface StaffDirectoryRow extends StaffDirectoryBaseRow {
  speciality?: string | null;
  serviceCount?: number;
  location?: string | null;
  assignedDoctors?: { id: string; name: string | null }[];
  assignedDoctorsScope?: 'assigned_doctors' | 'all_doctors';
  lab?: { id: string; name: string | null } | null;
  pharmacy?: { id: string; name: string | null } | null;
}

export interface StaffDirectoryFilterOption {
  label: string;
  value: string;
}

// Every option that exists in the clinic, not only those on the current page,
// so a dropdown does not change as the user paginates.
export interface StaffDirectoryFilterOptions {
  speciality?: StaffDirectoryFilterOption[];
  assignedDoctor?: StaffDirectoryFilterOption[];
  location?: StaffDirectoryFilterOption[];
  lab?: StaffDirectoryFilterOption[];
  pharmacy?: StaffDirectoryFilterOption[];
}

export interface StaffDirectorySummary {
  total: number;
  active: number;
  inactive: number;
  rejected: number;
  newThisMonth: number;
}

export interface StaffDirectoryResult {
  users: StaffDirectoryRow[];
  summary: StaffDirectorySummary;
  filterOptions: StaffDirectoryFilterOptions;
  availableFilters: string[];
  pagination: {
    page: number;
    pageSize: number;
    totalRecords: number;
    totalPages: number;
  };
}

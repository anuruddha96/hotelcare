export interface StaffSchedulingProfile {
  id?: string | null;
  role?: string | null;
  actsAsHousekeeper?: boolean | null;
}

/**
 * staff_schedules.user_id is a foreign key to profiles.id. Keep that profile
 * identifier as the single schedule identity and fail closed if it is absent.
 */
export function getCanonicalScheduleUserId(profile: StaffSchedulingProfile): string | null {
  const profileId = profile.id?.trim();
  return profileId || null;
}

/**
 * Shared department classification for schedule UI/filtering. This deliberately
 * remains role-based so a secondary housekeeping capability does not rewrite a
 * staff member's HR/primary department.
 */
export function departmentForRole(role?: string | null): string {
  const value = (role || '').trim().toLowerCase();
  if (value.includes('housekeeping')) return 'Housekeeping';
  if (value.includes('maintenance')) return 'Maintenance';
  if (value.includes('reception') || value.includes('front_office')) return 'Reception';
  if (value.includes('finance')) return 'Finance';
  if (value.includes('marketing')) return 'Marketing';
  if (value.includes('breakfast')) return 'Breakfast';
  if (value.includes('control')) return 'Control';
  if (value.includes('back_office')) return 'Back Office';
  if (value === 'hr') return 'HR';
  if (value.includes('manager') || value === 'admin' || value.includes('top_management')) return 'Management';
  return 'Other';
}

/**
 * Explicit housekeeping capability used by later Auto Assign integration.
 * A user's primary HR department remains unchanged; acts_as_housekeeper simply
 * grants housekeeping scheduling eligibility when deliberately configured.
 */
export function canProfileWorkHousekeeping(profile: StaffSchedulingProfile): boolean {
  return profile.actsAsHousekeeper === true || departmentForRole(profile.role) === 'Housekeeping';
}

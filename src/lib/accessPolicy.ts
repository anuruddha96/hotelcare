// App-side entry to the shared access policy (one source of truth with the
// Edge Functions). See supabase/functions/_shared/accessPolicy.ts.
export {
  ACCESS_ROLES,
  ACCESS_ROLE_DESCRIPTION,
  ACCESS_ROLE_LABEL,
  ACCESS_ROLE_PERMISSIONS,
  DEFAULT_PERMISSION_FOR,
  accessRoleFitsPermission,
  accessRoleFromPermission,
  accessRolesForPermission,
  capabilitiesFor,
  defaultDashboardTabFor,
  effectiveAccessRole,
  hasExplicitAccessRole,
  isAccessRole,
  landingPathFor,
  miraScopesFor,
} from '../../supabase/functions/_shared/accessPolicy';
export type {
  AccessCapabilities,
  AccessRole,
  AccessSubject,
  LandingContext,
  MiraScope,
  ScheduleScope,
} from '../../supabase/functions/_shared/accessPolicy';

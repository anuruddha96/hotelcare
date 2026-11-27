/**
 * Shared organization scope for training catalogue and privileged training actions.
 * Shared guides are usable by authenticated accounts with an organization.
 * SLNT-specific guides, including future slnt_ keys, belong only to SLNT.
 * Do not infer the organization from the URL or client request.
 */
export function trainingGuideAllowed(slug:string, organization:string|null|undefined):boolean {
  if(typeof slug!=='string'||!slug.trim()||typeof organization!=='string'||!organization.trim())return false;
  const org=organization.trim().toLowerCase();
  return !slug.trim().toLowerCase().startsWith('slnt_') || org==='slnt' || org==='slnt-group';
}
export function trainingTargetAllowed(caller:{organization_slug?:string|null;is_super_admin?:boolean|null},target:{organization_slug?:string|null},isHR:boolean):boolean {
  if(!target.organization_slug)return false;
  // Only an explicitly designated platform super-admin retains global administration.
  // HR is always restricted, including if an account has a super-admin flag.
  return (!isHR&&caller.is_super_admin===true)|| (!!caller.organization_slug&&caller.organization_slug===target.organization_slug);
}

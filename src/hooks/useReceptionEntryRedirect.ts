import { useEffect, useState } from 'react';
import { effectiveAccessRole, type AccessSubject } from '@/lib/accessPolicy';

type EntryContext = {
  ready: boolean;
  userId: string | null;
  profile: AccessSubject;
  organizationSlug: string;
  pathname: string;
  search: string;
  hash: string;
};

/** A fresh authenticated reception session opens the planner once.
 * A reload remounts this hook, whereas SPA navigation keeps it mounted.
 * Never intercept password recovery or keep redirecting during normal work.
 */
export function useReceptionEntryRedirect({
  ready, userId, profile, organizationSlug, pathname, search, hash,
}: EntryContext): string | null {
  const [enteredUserId, setEnteredUserId] = useState<string | null>(null);
  const recovery = /\/reset-password\/?$/.test(pathname);
  const target = `/${organizationSlug}/reception`;
  const isReception = effectiveAccessRole(profile) === 'reception';
  const redirect = ready && userId && enteredUserId !== userId && !recovery && isReception
    && (pathname !== target || !!search || !!hash) ? target : null;

  useEffect(() => {
    if (!ready) return;
    if (!userId) setEnteredUserId(null);
    else if (!recovery && !redirect) setEnteredUserId(userId);
  }, [ready, userId, recovery, redirect]);

  return redirect;
}

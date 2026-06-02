import { useEffect } from 'react';
import { syncOptInFromBrowser } from '@/lib/locationPreference';

/** Mount once at root: silently sync our opt-in with the browser permission
 *  on boot and whenever the tab becomes visible. Never prompts. */
export function LocationPermissionBoot() {
  useEffect(() => {
    void syncOptInFromBrowser();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void syncOptInFromBrowser();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  return null;
}

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type FinanceProfile =
  | 'none' | 'uploader' | 'reviewer' | 'controller' | 'chief_controller' | 'management_read';

// Roles that already had edit/verify rights before finance profiles existed —
// they keep them so nothing regresses for current users.
const LEGACY_REVIEW_ROLES = [
  'admin', 'top_management', 'top_management_manager', 'manager',
  'control_finance', 'back_office', 'back_office_manager', 'control_manager',
];
const FINANCE_ADMIN_ROLES = ['admin', 'top_management', 'top_management_manager'];

export interface FinanceAccessState {
  loading: boolean;
  /** Explicit finance profile assigned in Finance Access (null when not assigned). */
  assignedProfile: FinanceProfile | null;
  companyIds: string[];
  hotelIds: string[];
  /** Can review extracted data and submit it for approval. */
  canReview: boolean;
  /** Approving/rejecting requires an explicit controller profile — never implied by being a system admin. */
  canApprove: boolean;
  /** Can manage legal entities, categories, cost centres and finance access. */
  canManageFinance: boolean;
  /** View-only management access. */
  readOnly: boolean;
}

export function useFinanceAccess(): FinanceAccessState {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [assignedProfile, setAssignedProfile] = useState<FinanceProfile | null>(null);
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [hotelIds, setHotelIds] = useState<string[]>([]);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('finance_access')
        .select('id, profile, finance_access_companies(company_id), finance_access_properties(hotel_id)')
        .eq('user_id', user.id)
        .maybeSingle();
      if (cancelled) return;
      setAssignedProfile((data?.profile as FinanceProfile) ?? null);
      setCompanyIds(((data as any)?.finance_access_companies ?? []).map((c: any) => c.company_id));
      setHotelIds(((data as any)?.finance_access_properties ?? []).map((p: any) => p.hotel_id));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const role = profile?.role ?? '';
  const canApprove = assignedProfile === 'controller' || assignedProfile === 'chief_controller';
  const canReview =
    canApprove ||
    assignedProfile === 'reviewer' ||
    LEGACY_REVIEW_ROLES.includes(role);
  const canManageFinance = FINANCE_ADMIN_ROLES.includes(role) || assignedProfile === 'chief_controller';

  return {
    loading,
    assignedProfile,
    companyIds,
    hotelIds,
    canReview,
    canApprove,
    canManageFinance,
    readOnly: assignedProfile === 'management_read' && !canReview,
  };
}

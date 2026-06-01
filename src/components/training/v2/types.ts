// Training v2 — types
export type LangCode = 'en' | 'hu' | 'es' | 'vi' | 'mn';

export type RoleKey =
  | 'housekeeping'
  | 'housekeeping_manager'
  | 'manager'
  | 'admin'
  | 'top_management'
  | 'top_management_manager'
  | 'maintenance'
  | 'maintenance_manager'
  | 'reception'
  | 'reception_manager';

export type GuardKey =
  | 'always'
  | 'is_signed_in'
  | 'has_active_assignment'
  | 'has_in_progress_cleaning'
  | 'is_manager'
  | 'never_block';

export interface I18nText {
  en: string;
  hu?: string;
  es?: string;
  vi?: string;
  mn?: string;
}

export interface TrainingStepV2 {
  key: string;                       // stable id within curriculum
  title: I18nText;
  body: I18nText;
  selector?: string;                 // CSS selector to spotlight; centered if absent
  route?: string;                    // navigate to this path before locating selector
  tab?: string;                      // emit tour:navigate {tab} (existing convention)
  precondition?: GuardKey;           // skip/defer if false
  waitFor?: GuardKey;                // only proceed once true (polls)
  optional?: boolean;                // never block on this step
  ctaLabel?: I18nText;               // primary CTA replaces "Next" label
}

export interface TrainingCurriculum {
  slug: string;                      // persisted in user_tour_progress.tour_key
  name: I18nText;
  description: I18nText;
  roles: RoleKey[];
  category: 'core' | 'feature_promo';
  priority: number;
  steps: TrainingStepV2[];
}

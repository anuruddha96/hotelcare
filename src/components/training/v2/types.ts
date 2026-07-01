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
  | 'has_any_assignment_today'
  | 'has_in_progress_cleaning'
  | 'is_manager'
  | 'hotel_selected'
  | 'is_online'
  | 'not_switching_hotel'
  | `data_loaded:${string}`
  | 'never_block';

export interface I18nText {
  en: string;
  hu?: string;
  es?: string;
  vi?: string;
  mn?: string;
}

export interface TrainingStepV2 {
  key: string;
  title: I18nText;
  body: I18nText;
  selector?: string;
  route?: string;
  tab?: string;
  precondition?: GuardKey;
  waitFor?: GuardKey;
  optional?: boolean;
  ctaLabel?: I18nText;
  /** Optional event name emitted to analytics when the step is shown. */
  analyticsEvent?: string;
}

export interface TrainingCurriculum {
  slug: string;
  name: I18nText;
  description: I18nText;
  roles: RoleKey[];
  category: 'core' | 'feature_promo';
  priority: number;
  steps: TrainingStepV2[];
  /**
   * Optional ordered list of curriculum slugs to auto-play once this one
   * finishes. Lets us stitch small modules into one continuous walkthrough
   * without duplicating steps. Each linked curriculum remains independently
   * launchable from the Training Center.
   */
  chain?: string[];
}

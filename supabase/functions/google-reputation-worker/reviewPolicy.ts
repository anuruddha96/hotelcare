/**
 * Google review polling safety policy.
 * Only recent, low-risk, explicitly authorized 4-5 star reviews can be
 * automatically published. Older reviews remain available for manager review.
 */
export const AUTO_REPLY_WINDOW_DAYS = 7;
export const REVIEW_SYNC_LOOKBACK_DAYS = 14;
export const MAX_REVIEW_PAGES = 10;

export function autoEligible(
  location: any,
  stars: number,
  risk: string,
  reviewTime: string | null,
  now = Date.now(),
): boolean {
  if (!location?.is_active || !location?.auto_reply_enabled || !location?.auto_reply_enabled_at) return false;
  if (risk !== "low" || location.reply_mode === "draft_only") return false;
  // Never publish 1-3 star reviews without a manager, even if settings are lax.
  if (stars < 4) return false;
  const minimum = Math.max(4, Math.min(5, Number(location.min_auto_rating || 4)));
  const approvalFloor = Math.max(4, Math.min(5, Number(location.require_approval_below_rating || 4)));
  if (stars < minimum || stars < approvalFloor) return false;
  const created = Date.parse(reviewTime || "");
  const authorized = Date.parse(location.auto_reply_enabled_at);
  if (!Number.isFinite(created) || !Number.isFinite(authorized)) return false;
  // Never automatically answer reviews that predate a venue's consent.
  if (created < authorized || created > now) return false;
  const age = now - created;
  if (age > AUTO_REPLY_WINDOW_DAYS * 86_400_000) return false;
  const delay = Math.max(0, Math.min(1440, Number(location.auto_reply_delay_minutes || 0))) * 60_000;
  return age >= delay;
}

/**
 * Review API is sorted by updateTime descending. Keep paging past a busy
 * first page while its oldest update is still within the recent lookback.
 * A fixed page cap protects Google's quota and worker runtime.
 */
export function shouldFetchNextReviewPage(
  pageReviews: Array<{ updateTime?: string; createTime?: string }>,
  nextPageToken: string,
  pagesFetched: number,
  now = Date.now(),
): boolean {
  if (!nextPageToken || !pageReviews.length || pagesFetched >= MAX_REVIEW_PAGES) return false;
  const oldest = pageReviews[pageReviews.length - 1];
  const modified = Date.parse(oldest.updateTime || oldest.createTime || "");
  return !Number.isFinite(modified) || now - modified <= REVIEW_SYNC_LOOKBACK_DAYS * 86_400_000;
}

/** Build the tenant-scoped Payments route used by every billing call-to-action. */
export function billingPathFor(organizationSlug?: string | null, params?: URLSearchParams) {
  const slug = organizationSlug?.trim();
  if (!slug) return '/';
  const query = params?.toString();
  return `/${encodeURIComponent(slug)}/billing${query ? `?${query}` : ''}`;
}

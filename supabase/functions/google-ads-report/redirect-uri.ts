// The OAuth callback must return to the authenticated application, not the public marketing site.
// Never accept a redirect URL or origin from the request body.
export function googleAdsRedirectUri(slug: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  return "https://my.hotelcare.app/" + slug + "/google-ads";
}

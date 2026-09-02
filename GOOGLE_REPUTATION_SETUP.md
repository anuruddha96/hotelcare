# HotelCare Google Reputation setup

The UI, database foundation and authenticated backend status/OAuth-start flow are implemented on this branch.

## Required Supabase secrets

- `GOOGLE_BUSINESS_CLIENT_ID`
- `GOOGLE_BUSINESS_CLIENT_SECRET`
- `GOOGLE_BUSINESS_TOKEN_KEY` — a strong random encryption key used only server-side for Google refresh/access tokens.

## Google Cloud

1. Use a Google Cloud project owned by HotelCare/RD Hotels.
2. Configure an OAuth web client and request/enable the required Google Business Profile APIs.
3. Add this redirect URI exactly: `https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/google-business-oauth-callback`
4. The OAuth scope is `https://www.googleapis.com/auth/business.manage`.

## Safety defaults

- Browser clients have no direct access to Google token/review tables.
- Reputation access is limited to admin/top-management roles.
- Default reply mode is `draft_only`.
- Do not enable automatic negative-review replies during the first rollout.

## Next implementation after credentials are configured

Complete encrypted token persistence in the OAuth callback, Google account/location discovery, map Hotel Ottofiori and Ottofiori Brunch & Cafe to `hotel_id = ottofiori`, review sync, AI reply generation using the existing OpenAI backend secret, manual publish, and then optional 4–5 star auto-publishing.
# HotelCare Google Reputation

Initial rollout: Hotel Ottofiori and Ottofiori Brunch & Cafe.

Required Supabase Edge Function secrets:
- `GOOGLE_BUSINESS_CLIENT_ID`
- `GOOGLE_BUSINESS_CLIENT_SECRET`
- `GOOGLE_BUSINESS_TOKEN_KEY`

Google OAuth redirect URI:
`https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/google-business-oauth-callback`

OAuth scope:
`https://www.googleapis.com/auth/business.manage`

The callback encrypts Google access and refresh tokens with AES-GCM before persistence. Browser roles have no direct access to the Google connection/review tables. The initial reply mode is `draft_only`; users explicitly approve replies before publishing them to Google.

Flow:
1. Executive opens `/{organization}/reputation`.
2. Connect Google Business Profile.
3. HotelCare discovers Google accounts and locations.
4. Map Hotel Ottofiori and Ottofiori Brunch & Cafe to HotelCare property `ottofiori`.
5. Sync reviews.
6. Generate an AI draft and approve/publish manually.

Auto-reply modes are represented in the schema but should remain disabled until the manual workflow is verified in production.

# Google Ads OAuth verification video — HotelCare

Project: hotelcare-507413 (801466430391). This runbook is for an authorized RD Hotels administrator using a permitted pilot account. It is not a substitute for Google verification or evidence that production sync has succeeded. At the preparation check on 27 Nov 2026, RD Hotels had no connected accounts and no successful syncs. Complete actual consent and data retrieval before recording/submission.

## Prerequisites
- In Google Auth Platform > Data access, add https://www.googleapis.com/auth/adwords. Retain the scopes genuinely needed for existing verified workflows. Current Ads OAuth asks for openid, email and adwords.
- Confirm branding, privacy policy, authorized domains, consent audience and all OAuth clients. Keep new unverified scope requests confined to authorized pilot/staging workflows during review; do not enable broadly for external customers.
- Confirm the exact registered redirect URI currently expected by the backend: https://my.hotelcare.app/rdhotels/google-ads. Start from that same origin with an authenticated RD Hotels admin session. If the deployed app is on a different origin, resolve callback and registered URI consistency before recording; do not expose authorization codes.
- Authorize a Google identity permitted to use the chosen advertising account. Use an account with actual authorized reporting data; do not seed fabricated production metrics. Avoid recording passwords, passkeys, tokens, private keys or unrelated customer data.

## Recording storyboard (English)
1. Open HotelCare, show the application name and address, log in with the authorized administrator, select RD Hotels and open Google Ads. Narration: "HotelCare is a hospitality operations platform. Its Google Ads reporting module lets authorized organizations monitor advertising performance."
2. Click Connect Google account. Show Google's actual unverified-app warning for the pilot if it appears, then the full consent screen in English. Show matching app name and OAuth client ID in the authorization request, and the actual permission wording. Narration: "HotelCare requests identity and email to associate the authorized connection with the correct Google account, and the Google Ads scope to retrieve advertising reports. Google Ads uses this scope for its API; this integration does not expose campaign write actions."
3. Select the permitted Google account, grant the permissions and return to HotelCare. Show the connected identity and discovered advertising accounts. Enable only the intended pilot advertiser. Narration: "Only an authenticated administrator in the organization can configure the connection. The administrator explicitly selects the account to synchronize."
4. Select the advertiser, use Sync now and Refresh connections. When the last sync is successful, choose the last 30 days and Load report. Show the actual report and coverage. If a job is still running, pause recording and resume once successful; do not represent incomplete data as complete.
5. Scroll through KPI cards, spend and conversion value chart, campaign performance and configured budgets. Explain the current account currency and reporting dates. Narration: "The dashboard displays actual Google Ads impressions, clicks, cost, conversions and attributed conversion value, with campaign and budget breakdowns. Google Ads attributed conversion value is not verified hotel revenue."
6. Show date range filtering and the Disconnect control. If appropriate, demonstrate a real disconnect at the end and reconnect later. Narration: "The application stores authorization credentials encrypted server-side. Disconnect stops synchronization and removes stored refresh credentials for that connection; historical reports are retained securely. Campaign changes are disabled."
7. Demonstrate any additional consent workflows, OAuth clients and requested scopes applicable to the project. Verify that every scope in the submission is covered. Do not claim that planned Phases 3–6 are deployed.

## Submission
- Upload the complete genuine demonstration to YouTube as Unlisted. Check the link is accessible to reviewers. Paste the link into the Data access page's demo video field and submit through Verification Center.
- Check privacy-policy disclosures, any transfer or AI usage of Google Ads data (including the existing optional Mira snapshot feature) and applicable Google API policies before submission. Demonstrate and disclose actual enabled usage; if not yet compliant, restrict it before public rollout.
- The recording guide is available inside the authenticated Google Ads page; it introduces no new permissions or reporting data. The user must record the real OAuth interaction.

Official requirements: https://support.google.com/cloud/answer/13804565 ; https://support.google.com/cloud/answer/15549135 ; https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification

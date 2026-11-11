# HotelCare AI workspace

The assistant page (`/:org/assistant`) is a full chat workspace on top of the
existing HotelCare assistant. This note covers what was added, how access is
decided, and what has to happen at rollout.

## What it adds

| Area | What | Where |
|---|---|---|
| Workspace | Sidebar with search (Ctrl/Cmd K), projects, pinned and recent chats; rename, move, delete | `src/pages/AssistantPage.tsx`, `src/components/assistant/AssistantSidebar.tsx` |
| Opening screen | "Where to start" cards computed from live data by fixed rules (no AI call, no message used) | `supabase/functions/assistant-priorities`, `AssistantWelcome.tsx` |
| Charts | The model calls `render_chart` with numbers it just read; drawn in the app, with a table view; saved with the answer | `AssistantChart.tsx` |
| Pricing review | `review_pricing`: events, occupancy vs booking window, 7-day pickup, entry rate, competitor median, per-date stance and whole-euro step | `supabase/functions/_shared/pricingReview.ts` |
| Market | `get_competitor_rates` | `_shared/assistantWorkspace.ts` |
| Reputation | `get_reputation_overview` (Google reviews) | same |
| Restaurant | `get_restaurant_reservations` (reservations and covers) | same |
| Images | `generate_image`, 10 per user per day, private bucket `assistant-media` | same |
| Projects | Standing instructions per project, applied to every chat in it | `assistant_projects` |
| Audit | Thread, tokens, duration and workflow per turn | `assistant_audit_log` |

## Access

Nothing new is trusted from the browser. A tool is only registered for a role
that may open the matching screen, and every query is limited to the caller's
organization and authorized hotels.

| Tool | Roles |
|---|---|
| `render_chart` | every assistant role (it can only plot what the role could already read) |
| `review_pricing`, `get_competitor_rates` | revenue scope: admin, top management, manager |
| Applying a price proposal | admin, top management (unchanged `adjust_revenue_prices` rule) |
| `get_reputation_overview` | admin, top management (same as the Reputation screen) |
| `get_restaurant_reservations` | reception scope |
| `generate_image` | admin, top management, manager |

Project instructions are passed as user preferences. They cannot widen access:
the tools a turn has are decided before the instructions are read.

## How a pricing review runs

1. The router sends "review / check / optimise prices for a period" to the
   tool-using agent on the analysis model with high reasoning effort.
2. `review_pricing` returns a stance per night and ready proposals. The euro
   steps come from `pricingReview.ts`, never from the model:
   - never discount a night with 3 or fewer rooms left or a high-impact event;
   - only step down when the competitor scan is under 48 hours old, at least
     two competitors are priced, and our entry rate is more than 5% above their
     median; never below the automation minimum rate;
   - at most 20 euros per step, grouped into ranges of at most 7 nights.
3. Each proposal becomes a confirmation card. Confirming calls the existing
   `assistant-apply-action`, which re-reads the published calendar and uses
   the Revenue publishing queue with all its safety checks.

The same step is applied to every room type and occupancy price of a night.

## Rollout

1. Apply `supabase/migrations/20261111180000_assistant_workspace.sql`.
2. Deploy `assistant-chat`, `assistant-chat-router`, `assistant-priorities`.
3. Optional secrets: `OPENAI_AGENT_MODEL` (model for the pricing review,
   defaults to the standard model) and `OPENAI_IMAGE_MODEL` (defaults to
   `gpt-image-1`).

The functions and the app tolerate the migration being applied later: pins,
projects and saved charts simply stay off until the columns exist.

## Mailboxes and review replies

Managers connect their **own** work mailbox from **Mailboxes** in the
assistant sidebar. Three ways, shown when available:

| Way | Works for | Company setup needed |
|---|---|---|
| **Email + password (IMAP/SMTP)** | the hotel's own domain mail (cPanel, Rackhost, …), Gmail and Google Workspace with an *app password*, GMX, Yahoo and most others | none (on by default) |
| Sign in with Google | Gmail / Google Workspace | Google Cloud OAuth client with Gmail scopes |
| Sign in with Microsoft | Outlook / Microsoft 365 | Microsoft Entra app registration |

Microsoft 365 mailboxes need the Microsoft sign-in: Microsoft no longer allows
password sign-in for apps. The form detects Outlook / Microsoft 365 addresses
(also custom domains whose mail runs on Microsoft) and says so.

For the password option the server settings are found automatically from the
address (known providers, Google-hosted domains, `mail.` / `imap.` /
`smtp.` names and the domain's MX host); they can be entered by hand under
*Advanced*. Only IMAP over SSL (993) and SMTP over SSL (465) are used; servers
that resolve to private or loopback addresses are refused. The password is
stored AES-GCM encrypted. Eight failed connection attempts per hour lock the
form for that person.

| Tool | What it does | Roles |
|---|---|---|
| `search_mail`, `read_mail` | Find and read emails in the connected inbox | admin, top management, manager, department managers |
| `draft_email` | Prepares an email or a threaded reply as a card | same |
| `draft_review_reply` | Prepares a Google review reply as a card | admin, top management (same as Reputation) |

Rules that hold for every role:

- The assistant has **no send tool**. An email leaves only when the person taps
  **Send** on the card (`assistant-mail`, action `send`), from their own
  mailbox. A review reply is published only on **Publish to Google**, through
  the existing `google-reputation` → `publish_reply` path and its checks.
- Email content is passed to the model as untrusted data and the prompt forbids
  following instructions inside it. Recipients outside the sender's domain are
  flagged on the card. Header injection is rejected.
- Tokens are AES-GCM encrypted; the mailbox tables are server-only.
- At most 10 recipients per email and 40 assistant emails per person per day.
  Drafts expire after 48 hours.
- Administrators see `assistant_mail_log`: who sent what subject to whom and
  when, plus connects and disconnects. Message bodies are not logged.

### Switching mailboxes on

1. Apply `supabase/migrations/20261111210000_assistant_mail.sql` (applied).
2. Deploy `assistant-mail`, `assistant-mail-oauth-callback`, `assistant-chat`.
3. Secret `ASSISTANT_MAIL_TOKEN_KEY`: any long random string (32 bytes base64
   is ideal). Falls back to `GOOGLE_BUSINESS_TOKEN_KEY` when not set, so the
   email + password option works as soon as the functions are deployed.
   `ASSISTANT_MAIL_IMAP_ENABLED=false` switches that option off.
4. **Microsoft 365**: register an app in Microsoft Entra ID → App
   registrations. Redirect URI (Web):
   `https://<project>.supabase.co/functions/v1/assistant-mail-oauth-callback`.
   Delegated permissions: `offline_access`, `openid`, `email`, `User.Read`,
   `Mail.Read`, `Mail.Send`. Create a client secret. Set
   `MICROSOFT_MAIL_CLIENT_ID`, `MICROSOFT_MAIL_CLIENT_SECRET`, and
   `MICROSOFT_MAIL_TENANT` (your tenant id; `common` allows any organisation).
   Grant admin consent once so staff are not asked individually.
5. **Google Workspace**: in Google Cloud, enable the Gmail API, add the redirect
   URI above to an OAuth client, and add the scopes `gmail.readonly` and
   `gmail.send`. Set the OAuth consent screen to **Internal** so only your
   Workspace domain can connect and Google's restricted-scope verification is
   not required. Set `GOOGLE_MAIL_CLIENT_ID` and `GOOGLE_MAIL_CLIENT_SECRET`
   (or `GOOGLE_MAIL_ENABLED=true` to reuse the Google Business client).
6. Optional `ASSISTANT_APP_ORIGINS`: comma-separated extra app origins allowed
   as a return address after sign-in (the calling origin is always allowed).

A provider without credentials simply does not appear in the Mailboxes dialog.

## Not included yet

- Writing reservation changes back to Previo.

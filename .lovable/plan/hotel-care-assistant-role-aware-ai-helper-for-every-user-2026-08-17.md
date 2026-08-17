# Hotel Care Assistant — role-aware AI helper for every user

An always-available assistant button on every signed-in page. It answers how-to questions about the
app, general knowledge questions, and questions about live hotel data — always inside the asker's
role, hotel and organization. Runs on your own OpenAI key (`OPENAI_API_KEY`, already stored) with a
cheap model by default.

## What each user gets

- **Floating assistant button** on all authenticated pages: side panel on desktop, full-height sheet
  on mobile. Named assistant with its own small logo.
- **Text chat with speak-to-type**: a microphone button dictates the question (browser speech
  recognition, no extra cost); answers stream back as markdown text.
- **Conversations**: threaded chats with a thread list, a "New chat" action and a URL per thread
  (`/assistant/:threadId`), stored in the database and scoped to the signed-in user, so a reload
  restores the conversation. (Say the word if you'd rather have a single rolling conversation.)
- **Answers in the user's app language** (en/hu/es/vi/mn/ru/uk).

## Who can ask what

Access is decided **server-side** from the signed-in profile — never from anything the browser sends.

| Role group | Live data the assistant may read |
| --- | --- |
| admin | everything, all organizations |
| top management / manager | all departments of **their own hotel(s) in their own organization only** — revenue, housekeeping, maintenance |
| housekeeping (+ manager) | housekeeping only: room status, assignments, cleaning progress |
| maintenance (+ manager) | maintenance only: tickets, SLA, photos |
| reception / front office | reception scope: arrivals, room status, breakfast; **no revenue** |
| everyone | how-to help about the app + general knowledge |

Hard rules enforced in the backend, not in the prompt alone:
- Every data lookup is filtered by the asker's `organization_slug` and `assigned_hotel`. An SLNT user
  can never learn that RD Hotels or Ottofiori exist, and cannot ask how many hotels the company has.
- A tool the role may not use is not even offered to the model, so it cannot be talked into using it.
- Guest personal data, credentials and staff pay are never returned to anyone below admin.

## Requesting access to something above your role

When a question needs data outside the asker's scope, the assistant refuses politely and offers a
**Request access** button. The request (question, scope needed, reason) goes to the managers/admins of
that hotel, who approve or decline from the notification centre. An approval unlocks that specific
scope for a limited time (default 24h), after which it lapses. Every request, decision and every
answer that used elevated access is written to an audit log that admins can review.

## Live data it can answer from (first release)

- **Revenue** (revenue roles only): ADR, occupancy, RevPAR, rooms sold and left to sell, pickup, rate
  and min-stay for a date or month — e.g. "what is the ADR for January at this hotel".
- **Housekeeping**: dirty/clean/inspected counts, assignments per housekeeper, today's progress.
- **Maintenance**: open tickets, overdue SLA, per-room issue history.
- Plus the current date/time in Budapest so "today", "this month", "next weekend" resolve correctly.

## Model choice and cost

The backend grades each question and picks the model itself: a cheap, fast OpenAI model for how-to
and general questions, and a mid-tier model only for data analysis. Rate-limited per user per day so
one person cannot burn the budget. Full voice-to-voice can be added later on top of this.

## Admin insight

An admin-only view of what people ask (topics, unanswered questions, refusals and access requests)
for training purposes. Regular users never see it.

## Technical notes

- New tables: `assistant_threads`, `assistant_messages`, `assistant_access_requests`,
  `assistant_audit_log` — all with GRANTs and RLS scoped to the owner, plus a manager/admin read and
  approve path via `has_role`-style security-definer checks.
- New edge function `assistant-chat`: streams from the OpenAI Responses API using `OPENAI_API_KEY`,
  validates the caller's JWT, loads the profile server-side, and exposes a small set of **read-only,
  role-filtered tools** (`get_revenue_metrics`, `get_housekeeping_status`, `get_maintenance_tickets`,
  `get_app_howto`, `get_context_now`). Each tool re-applies the org/hotel filter itself.
- A compact how-to knowledge file built from the existing training curricula so answers cite the real
  workflow instead of inventing one.
- Frontend: `src/components/assistant/` (launcher, panel, thread list, composer with mic via the Web
  Speech API, markdown rendering), route `/:org/assistant/:threadId`, plus an admin insight page.

## Not in this phase

The assistant only reads — it never changes prices, assignments or tickets. Full spoken replies /
realtime voice conversation come after this ships.

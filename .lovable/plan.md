# Repair and upgrade the Hotel Care Assistant

## Goal
Make the assistant reliable on iPhone and desktop: no focus zoom or frozen composer, durable one-to-one chat history, clear thread navigation, correct-language OpenAI answers, and strict role/property data protection.

## Confirmed issues
- `AssistantLauncher` and `AssistantChat` each create their own `useAssistant` state. The launcher knows it just created a thread, but the chat does not; its empty database load can race with and replace the optimistic first message.
- The current composer uses a fixed `100dvh` sheet and scroll-to-bottom timeout, but does not follow iOS `visualViewport` changes when the keyboard opens. Safe-area padding is also applied globally and again inside the assistant.
- The sheet renders both its built-in close control and a second custom close button.
- Choosing a title in the panel changes the thread ID but leaves the user on the History tab. The full-page assistant has no Back action.
- The backend waits for a complete, non-streamed OpenAI/tool loop before returning. It only replays the first 30 stored messages, and persists the user message only after the answer finishes.
- Language matching is prompt-only, so an English latest message can still inherit another language from profile/history.
- Internal tools are role-filtered, but the admin path can skip organization filtering, thread ownership is not explicitly verified before the service-role write, and access-approval RLS is organization-scoped rather than organization-and-hotel scoped.

## Implementation

### 1. Rebuild the visible chat on stable chat primitives
- Install and compose AI Elements `conversation`, `message`, `prompt-input`, and `shimmer` primitives rather than maintaining the custom transcript/composer.
- Keep user messages right-aligned in a high-contrast bubble; render assistant markdown left-aligned directly on the chat surface.
- Show the user's message immediately, keep the textarea focused, and stream a visible “Thinking…” state followed by answer tokens.
- Replace the generic sparkle identity with a small Hotel Care assistant mark already consistent with the product.

### 2. Fix iPhone typing and keyboard behavior
- Use one responsive assistant shell with a single close control and a native scrolling transcript.
- Size the mobile panel from `window.visualViewport` while the keyboard is open, keep the composer inside the visible viewport, and preserve notch/home-indicator spacing without double safe-area padding.
- Guarantee a computed input font size of at least 16px, prevent horizontal overflow, and avoid forced smooth scrolling while the user is typing.
- Keep microphone and send controls fixed-size and reachable on iPhone Pro Max dimensions.

### 3. Make thread history dependable and easy to continue
- Lift assistant state to one owner so the launcher, tabs, thread list, and transcript share the same active thread/messages.
- Persist the user turn before model work begins and save the completed assistant turn when streaming finishes; surface any persistence failure.
- Load the complete ordered conversation for the route-derived thread ID and remount the chat when switching threads so messages cannot bleed or disappear.
- Make every history title a clear selectable row. Selecting it opens that thread, switches to Chat automatically, focuses the composer, and lets the user continue replying.
- Show title, last-message preview, and updated time; retain New chat and safe delete behavior.
- Add a Back control on the full-page assistant that returns to the prior Hotel Care screen, with the organization home as a safe fallback.

### 4. Stream through the saved OpenAI credential
- Keep `OPENAI_API_KEY` server-side in the existing Supabase Edge Function and migrate the call to the AI SDK streaming pattern; never expose the credential to the browser.
- Send the complete thread history on every turn and keep tool-call/result pairs intact.
- Preserve AI-generated thread titles and update the list immediately after the first answer.
- Detect the language of the latest user message explicitly and require the answer and title to use that language; use the profile language only when the message is genuinely ambiguous.
- Return OpenAI/gateway failures as visible chat errors rather than a fabricated assistant answer.

### 5. Verify internal answers and harden authorization
- Verify thread ownership server-side before reading, writing, or streaming any turn.
- Derive role, organization, and assigned hotel only from the authenticated profile. Apply both `organization_slug` and `assigned_hotel`/hotel filters inside every internal-data tool, including privileged roles, in line with Hotel Care tenant isolation.
- Offer only tools allowed for the caller’s department; retain the temporary-access flow for unavailable scopes.
- Tighten access-request approval to an authorized manager for the same organization and relevant hotel/venue, and keep decisions/elevated answers audited.
- Validate each internal tool against the app’s authoritative tables and currency/date semantics. Answers using live data will state the hotel and date range; missing or conflicting data will be reported instead of guessed.

## Validation
- Test on an iPhone Pro Max-sized viewport: open animation, focus without zoom, continuous typing, keyboard open/close, send, stream, and composer visibility.
- Create two threads, send multiple messages in each, switch by title, reload each dedicated URL, and verify the correct full history remains and is replyable.
- Verify English, Hungarian, Spanish, Vietnamese, and Mongolian prompts answer in the latest prompt’s language.
- Test reception, housekeeping, maintenance, manager, top-management, and admin accounts against allowed and forbidden questions; confirm cross-hotel and cross-organization requests return no data and access requests reach only the relevant approvers.
- Run the exact deployed Edge Function path with the saved OpenAI key and inspect the real streamed response before completion.

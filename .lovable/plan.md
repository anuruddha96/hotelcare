# Hotel Care Assistant: fix voice input, titles, history and complaints

## 1. Voice-to-text that actually works

Today dictation uses only the browser's `SpeechRecognition`. On iOS Safari (the main device here) that API is unreliable or absent, single-shot, and dies silently, so the mic button appears to do nothing.

Change to a two-path approach:
- Primary: record the microphone with `MediaRecorder` and transcribe server-side through a new `assistant-transcribe` Edge Function that calls the Lovable AI Gateway speech-to-text model (`openai/gpt-4o-mini-transcribe`). Works the same on iPhone, Android and desktop.
- Show real states: requesting permission, recording (with elapsed timer and a live level indicator), transcribing, and done. The transcript is inserted into the composer for review before sending, never sent silently.
- Clear errors instead of silence: permission denied, no microphone, no speech detected, network failure.
- Pass the user's UI language as a transcription hint so Hungarian, Spanish, Vietnamese and Mongolian dictation transcribe correctly.
- Keep native `SpeechRecognition` only as an instant fallback when recording is unavailable.

## 2. Real conversation titles

Titles are currently the first 60 characters of the user's question, which is why the list reads as long, meaningless text.

- After the first answer completes, generate a short 3-6 word topic title with a cheap model, in the language of the user's message (for example "Ottofiori arrivals today", "ADR improvement ideas").
- Fall back to a trimmed question snippet only if title generation fails.
- Let the user rename a conversation inline from the history list, and keep AI titles from overwriting a manual rename.

## 3. History that appears immediately

- Show a skeleton list instantly instead of an empty panel while threads load, and load threads as soon as the panel opens rather than waiting on profile-dependent effects.
- Cache the last loaded thread list so reopening the assistant renders instantly, then refresh in the background.
- Each row shows the title, a one-line preview of the last message, and a relative time ("2h ago"); rows group under Today / Yesterday / Earlier.
- Selecting a row opens the conversation and switches to the Chat tab; delete keeps a confirm step.
- Empty state explains how to start rather than showing a blank box.

## 4. Lodge a formal complaint

Reporting exists but is only reachable after a failed answer or when the AI happens to suggest it. Make it a first-class action:
- A "Report a problem" item in the assistant header menu, available at any time.
- A proper dialog: title, what happened, category (data wrong, something broken, access, suggestion, other), severity, and an option to attach the current conversation and the page context.
- The assistant can also draft the report from the conversation so the user only confirms.
- Confirmation with a reference number after submission, and a visible failure message if sending fails.
- Reports continue to save to `assistant_issue_reports` and email the Hotel Care team address held in the server secret; the reporter's role, property and organization stay attached.

## 5. Other gaps closed along the way

- Composer: keep focus after sending, disable send while empty, show a clear stop control while the answer streams.
- Persist a stopped answer instead of losing it, as the side channel already supports.
- Show the assistant's copy/retry actions on answers.
- Keep every read scoped to the signed-in profile's organization and hotel; no scoping change is part of this work.

## Technical notes

- New Edge Function `supabase/functions/assistant-transcribe/index.ts`: authenticated, accepts audio, forwards to the gateway `/v1/audio/transcriptions`, returns text only.
- Title generation runs in `supabase/functions/assistant-chat/index.ts` after the answer is saved, replacing the current slice-of-question logic; add a `title_locked` flag on `assistant_threads` for manual renames.
- Frontend work in `src/components/assistant/AssistantChat.tsx` (dictation hook, composer), `AssistantLauncher.tsx` (history list, header menu), a new `ReportProblemDialog.tsx`, and `src/hooks/useAssistant.ts` (thread previews, cache, rename).

## Validation

- Dictate on an iPhone-sized viewport in English and Hungarian and confirm the transcript lands in the composer.
- Start two conversations, confirm short topic titles appear after the first answer and survive reload.
- Reopen the assistant and confirm history renders immediately with previews and times.
- File a complaint end to end and confirm the row is stored and the email is sent.

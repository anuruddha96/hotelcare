# Add Azerbaijani Language + Home Page Language Switcher

## What's already done

Good news — partial groundwork already exists:
- `az` is registered in `supportedLanguages` in `src/hooks/useTranslation.tsx`.
- Browser language auto-detection is already implemented (line 2244-2251): on first visit, it reads `navigator.language` and picks a supported match, falling back to English. Once a user picks a language it's stored in `localStorage`.
- `az` translations exist in `useTranslation.tsx` (core), `highlighted-translations.ts`, and `notification-translations.ts`.
- `LanguageSwitcher` component already lists Azerbaijani 🇦🇿.

## What's missing

### 1. Azerbaijani translations missing in 6 bundles
The following bundles still only ship 3–5 languages (no `az`), so large parts of the app fall back to English when a user picks Azerbaijani:

| File | Current langs | Action |
|---|---|---|
| `src/lib/expanded-translations.ts` | en, hu, es, vi, mn | Add `az` |
| `src/lib/comprehensive-translations.ts` | en, hu, es, vi, mn | Add `az` |
| `src/lib/pms-translations.ts` | en, hu, es, vi, mn | Add `az` |
| `src/lib/maintenance-translations.ts` | en, hu, es, vi, mn | Add `az` |
| `src/lib/guest-minibar-translations.ts` | partial (3) | Add `az` (+ fill missing langs while there) |
| `src/lib/training-translations.ts` | partial (3) | Add `az` |
| `src/lib/breakfast-translations.ts` | sparse | Add `az` |

Translations will be professional Azerbaijani (Latin script) matching the tone of the existing Hungarian/Spanish bundles — hospitality / housekeeping / maintenance vocabulary.

### 2. Language switcher on the Auth (home) page
`src/pages/Auth.tsx` currently has no language control. Add the existing `<LanguageSwitcher />` in the top-right corner of the page (absolute-positioned, mobile-safe) so unauthenticated visitors can change language before signing in. No new component needed — reuse `src/components/dashboard/LanguageSwitcher.tsx`.

The `saveLanguagePreference` call inside the switcher writes to the DB only when a user is logged in; for guests it'll just update local state + `localStorage` (already handled by `useLanguagePreference`).

### 3. Browser-language detection on home page
Already working via `TranslationProvider`'s initial state. No change required — confirming this in the plan so we don't rebuild it. The Auth page will automatically render in the browser's language on first visit (if supported), or fall back to English.

## Out of scope
- No backend / schema changes.
- No changes to DB-stored content (hotel names, room types, seeded break types, location slugs).
- No changes to Previo polling, auth flow, or any business logic.
- Other minor untranslated strings flagged in earlier sessions are not re-touched here.

## Technical notes
- Each translation bundle file exports an object keyed by language code; adding `az: { ... }` is additive and type-safe (the `Language` union already includes `'az'`).
- Auth page switcher placement: `<div className="absolute top-4 right-4 z-10"><LanguageSwitcher /></div>` inside the existing page wrapper. Mobile (440px viewport) verified — switcher collapses to flag-only via its existing `hidden sm:inline` rule.

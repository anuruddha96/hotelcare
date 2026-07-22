## Plan

1. **Fix the translation cache issue**
   - Update the translation provider so stale cached bundles cannot override newly added static translations.
   - This addresses raw keys like `housekeeping.doNotDisturb` and `housekeeping.noServiceNoteLabel` still appearing after translations were added.

2. **Complete missing Ukrainian strings for this flow**
   - Add/verify Ukrainian labels for:
     - DND doorway button
     - DND photo dialog title, instructions, progress, no-photo/saved states
     - Take/Add/Capture/Cancel/Saving buttons
     - No Service title, warning, consent checkbox, note label/placeholder, confirm/cancel buttons

3. **Remove remaining hardcoded English in DND photo capture**
   - Replace hardcoded text in `EnhancedDNDPhotoCapture.tsx` such as `DND Photo - Room`, `Take Photo`, `Capture Photo`, `Starting camera...`, and toast messages with translation keys.

4. **Tighten the mobile UI for the dialogs**
   - Make the DND photo dialog content fit better on mobile: compact header, scrollable content, localized title, and footer button text that clearly closes/finishes the dialog.
   - Make the No Service confirmation dialog mobile-safe: avoid oversized text wrapping/overlap, use a compact native-scroll body, and keep action buttons reachable.

5. **Verify the fix visually**
   - Check the affected mobile screens after implementation to confirm no raw translation keys or English strings remain in the highlighted DND/No Service flow.
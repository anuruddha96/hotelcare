# Training releases

Add a new topic to the Training Center with the feature that it teaches. Use stable `data-training` attributes on the real controls and include all six app languages. Keep the topic focused on one job. Only navigation and previews should advance on click. Highlight the final operational action and let the user decide when to perform it.

For a feature that should be announced, add an entry to `src/components/training/v2/trainingReleases.ts`. Give the release a new immutable ID and reference the curriculum slug. Keep the guide and feature in the same delivery. The frontend tests validate the release manifest during PR checks.

After the feature and guide are live, an organization admin can approve the release from **Admin → Training → Training releases**. HotelCare offers it once in the app to eligible staff in that organization. The account-level receipt covers multiple devices. Users who already completed the guide or a guide it replaces can replay it from the Training Center.

The refresh of the existing guides starts with an empty release manifest. To announce a genuinely new workflow for a feature that has an existing guide, give the new workflow its own topic and release ID.

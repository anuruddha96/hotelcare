# Mobile training overlap regression

The housekeeper check-in training step must keep the actual swipe control visible and touchable while the training coach is open on a phone-sized viewport.

Regression scenario:
1. Open a housekeeping account that is not checked in.
2. Start `v2_housekeeper_first_day` and advance to `signin`.
3. Attendance opens automatically.
4. The spotlight surrounds only the swipe track, not the whole attendance intro block.
5. The swipe track sits above the training coach with clear separation.
6. Swiping the highlighted control checks the user in and advances the guide automatically.

The mobile stylesheet reserves the lower viewport for the coach and biases training anchors upward when the provider calls `scrollIntoView({ block: 'center' })`.

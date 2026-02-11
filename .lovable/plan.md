
## Plan: Add "Go to Team View" Button After PMS Upload Completes

### What Changes

After a PMS upload completes successfully, add a button next to the existing "Upload Another File" button that navigates the user directly to the Team View tab.

### Implementation

**File 1: `src/components/dashboard/HousekeepingTab.tsx`**
- Pass an `onNavigateToTeamView` callback prop to `<PMSUpload />` (line 263)
- The callback simply calls `setActiveTab('manage')` which switches to the Team View tab

**File 2: `src/components/dashboard/PMSUpload.tsx`**
- Accept an optional `onNavigateToTeamView?: () => void` prop
- In the results section (after line 983, next to the "Upload Another File" button), add a new button:
  - Label: "Go to Team View" with a Users icon
  - Variant: default (primary colored) to make it prominent
  - onClick: calls `onNavigateToTeamView()`
- Change the button layout from a single full-width button to a flex row with two buttons side by side

### Visual Result

After upload completes, the user sees:

```text
[Upload Another File]  [Go to Team View ->]
```

The "Go to Team View" button is styled as the primary action (solid color) since it's the most common next step, while "Upload Another File" remains as outline/secondary.

### Files Changed

| File | Change |
|------|--------|
| `src/components/dashboard/HousekeepingTab.tsx` | Pass `onNavigateToTeamView` prop to PMSUpload |
| `src/components/dashboard/PMSUpload.tsx` | Accept prop, add "Go to Team View" button in results section |

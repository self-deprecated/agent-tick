---
title: reorder settings page in phone app, have pairing QR be at the top when not set. Shows connected when it is, no need for input boxes when its setup right. Just the Forget Device and other togglable settings stay in that case
priority: medium
---

## Goal

Restructure the mobile app's Settings screen so the state of the app (paired vs. not paired) drives what's shown, instead of always showing every field. Pairing workflow lives at the top when unpaired; when paired, the screen is a compact list of togglable settings.

## Acceptance Criteria

### When **unpaired** (`deviceID` is empty)

- [ ] Top of screen: prominent "Scan Pairing QR" primary button with a one-line instruction ("Scan the QR code from `agent-tick pair` to connect").
- [ ] Below that: Server URL input field + Check Connection button.
- [ ] Below that: a collapsed "Advanced" section (disclosure) containing the existing Manual Pairing Code input and Manual Bearer Token input. Collapsed by default.
- [ ] Notifications section remains at the bottom.

### When **paired** (`deviceID` is set)

- [ ] Top of screen: existing `ConnectionBadge` + "Paired as <deviceID>" line (subtle, matches current style). No large hero element.
- [ ] Forget Device button.
- [ ] Notifications section (Enable, Test, Register Push, status line).
- [ ] **Hidden by default**: Server URL input, Manual Pairing Code input, Manual Bearer Token input, Advanced section. (These are only useful before pairing; no need to show them once connected.)
- [ ] Option to re-scan/re-pair is implicitly handled by "Forget Device" → returns to unpaired state.

### General

- [ ] Component logic lives in a single `SettingsScreen` with a branch on `deviceID` (or a derived `isPaired` boolean). No new top-level components needed.
- [ ] Styles match existing palette (`#f7f2e8` background, `#202124` text, etc.). No new colour tokens.
- [ ] App still compiles and runs on iOS + Android with `expo` tooling; no runtime errors when toggling between states.

## Design Decisions

- **Paired state is minimal**: only show what a paired user actually toggles (Forget Device, Notifications). Hide server URL, manual pairing code, and manual bearer token entirely — these are only useful before pairing.
- **Unpaired state puts pairing first**: big "Scan Pairing QR" button at the top, server URL below, Advanced (manual code + bearer token) collapsed by default.
- **Connected indicator is subtle**: keep the existing `ConnectionBadge` + "Paired as <id>" line. No large success card; matches existing visual language.

## Implementation Notes

- The `SettingsScreen` already receives `deviceID` as a prop. Branch on `deviceID ? pairedView : unpairedView` inside the component's render.
- For the collapsible Advanced section in the unpaired view, use React Native's `Pressable` + local state for `[advancedOpen, setAdvancedOpen]`. No new library required.
- Keep all existing handler props (`onScanPairing`, `onPairDevice`, `onForgetDevice`, etc.) — this is a reorganisation of the render, not a change to app behaviour.
- "Forget Device" clears `deviceID`, which flips the screen back to the unpaired layout automatically.

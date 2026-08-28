---
status: resolved
trigger: "now it does nothing after choosing a gpx file!!1 pls fix it"
created: 2026-08-28T10:34:01Z
updated: 2026-08-28T10:46:00Z
---

## Current Focus

hypothesis: Resolved. GPX import no longer depends on a successful external basemap request.
test: Completed blocked-map, normal-map, desktop WebKit, mobile WebKit, repeat-selection, unit-test, and build verification.
expecting: Complete.
next_action: Commit, deploy, and verify the public GitHub Pages build.

## Symptoms

expected: Choosing a GPX loads the route, updates the title and statistics, and enables replay.
actual: Nothing visibly happens after choosing a GPX file.
errors: No error message reported by the user.
reproduction: Open the public GitHub Pages site and choose a GPX while the external map style request cannot complete.
started: Reported after commit adc9487 deployed the playable-video fix.

## Eliminated

- hypothesis: The deployed page has a universal initialization or GPX parsing failure.
  evidence: Fresh Chrome loaded the public page without console errors and the controlled GPX updated the title to Gpx Upload Regression.
  timestamp: 2026-08-28T10:35:39Z

- hypothesis: The recorder bundle broke GPX selection in desktop Safari/WebKit.
  evidence: Fresh Playwright WebKit loaded the public page and imported the same GPX successfully without console errors.
  timestamp: 2026-08-28T10:37:36Z

- hypothesis: Mobile WebKit file selection is broken.
  evidence: Mobile WebKit imported the controlled GPX and updated the route normally.
  timestamp: 2026-08-28T10:38:40Z

## Evidence

- timestamp: 2026-08-28T10:34:01Z
  checked: Repository and deployment state.
  found: Local main was clean at adc9487 and matched origin/main.
  implication: The deployed build could be tested directly against the last working UI commit.

- timestamp: 2026-08-28T10:35:39Z
  checked: Public upload flow in fresh Chrome with a controlled GPX.
  found: Upload succeeded, title and route state updated, and no console errors occurred.
  implication: The failure depended on browser state, selected-file data, or map availability.

- timestamp: 2026-08-28T10:37:36Z
  checked: Public upload flow in fresh desktop WebKit with the controlled GPX.
  found: Upload succeeded and the route title updated with no JavaScript exception.
  implication: The issue was not a general Safari syntax or recorder-bundle initialization failure.

- timestamp: 2026-08-28T10:38:40Z
  checked: Public upload flow in mobile WebKit.
  found: File selection and parsing succeeded normally.
  implication: iPhone input handling was not the regression trigger.

- timestamp: 2026-08-28T10:41:29Z
  checked: Public upload with the OpenFreeMap style request forced to return 503.
  found: The GPX parsed and changed the title, but setup remained suspended at await mapLoaded; the empty-state overlay and zero statistics remained indefinitely.
  implication: A basemap request failure exactly reproduced the reported no-response state.

- timestamp: 2026-08-28T10:43:31Z
  checked: Fixed local build with the identical OpenFreeMap 503 interception.
  found: The internal fallback style loaded, the overlay closed, start/finish markers appeared, and distance/start/pace statistics populated.
  implication: The original stalled-import reproduction was fixed even with the external map unavailable.

- timestamp: 2026-08-28T10:45:10Z
  checked: Fixed local build with normal map loading and repeat selection of the same GPX.
  found: Normal import completed with no console errors, both file inputs reset to an empty value, and the same file imported successfully again.
  implication: The fallback did not regress the normal path and repeat selection is reliable.

## Resolution

root_cause: setup awaited mapLoaded without rejection, timeout, or fallback; a failed external style request left every import suspended forever.
fix: Added a local background style that activates on map errors or timeout, immediate upload feedback, and immediate file-input reset.
verification: npm test and npm run build passed; controlled GPX imports passed in Chrome, desktop WebKit, mobile WebKit, forced 503 fallback, normal map, and repeat-selection scenarios.
files_changed: [index.html, docs/index.html]

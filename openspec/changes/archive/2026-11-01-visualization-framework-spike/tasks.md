## 1. Isolated harness and fixtures

- [x] 1.1 Create `spikes/visualization/` with the TypeScript/React browser harness, npm lockfile, pinned candidate dependencies, runtime requirements and build/typecheck/test scripts.
- [x] 1.2 Add representative and deterministic approximately 100-node JSON fixtures, stable IDs, source files/ranges, and repeatable reset/rename/add/remove controls; check endpoint and source-reference validity.

## 2. Nested rendering and early webview check

- [x] 2.1 Render C4 nodes and system boundaries in React Flow; implement measured node/label dimensions and hierarchical ELK layout in a bundled worker. Browser evaluation and the geometry check verify child containment in both fixtures (`scripts/evaluate-browser.mjs`, `scripts/check-elk-geometry.mjs`).
- [x] 2.2 Map nested coordinates, ELK edge sections and label positions into custom edges; add automated nested-mapping and ID/source-preservation checks using a cross-boundary fixture. The browser check verifies the return edge, and the geometry diagnostic compares all rendered endpoints; latest run found zero detached routes in either fixture (`results/elk-geometry.md`).
- [x] 2.3 Build a minimal VS Code host loading the same viewer and worker from local assets with a restrictive CSP; smoke-test worker layout without a development server.

## 3. Updates and navigation

- [x] 3.1 Preserve geometry on non-geometric updates, viewport and surviving selection; clear removed selection, add explicit re-layout, and reject obsolete asynchronous results. Add focused checks for update ordering and state retention.
- [x] 3.2 Add simulated invalid input and layout-failure presentation that retains the last valid view, with stale-state recovery on a successful update.
- [x] 3.3 Implement validated node-ID navigation messages, fixture-range reveal and editor-to-diagram highlighting without loops; reject malformed/unknown navigation targets with a focused automated check.
- [x] 3.4 Verify pan/zoom, keyboard selection/activation and visible focus in light/dark themes; record failures rather than treating untested behavior as supported.

## 4. Packaging and licensing

- [x] 4.1 Verify pinned direct and bundled transitive licenses; add `THIRD_PARTY_NOTICES.md`, required license texts/copyright notices, exact versions and corresponding ELK source instructions using EPL-2.0.
- [x] 4.2 Build a local extension package including fixtures, worker and notices; inspect its contents and verify offline launch, layout and source navigation without external assets or an account.

## 5. Measurements and decision

- [x] 5.1 Record five initial-layout and scripted-update runs for both fixtures, including individual samples, median/max layout and request-to-render times, surviving-node displacement, graph sizes and machine/runtime details; assess pan/zoom during layout.
- [x] 5.2 Capture before/after screenshots and report readability of nested boundaries, long labels, parallel relationships and cross-boundary routes, including any manual repair needed.
- [x] 5.3 Document exact setup/run/build/package/verification commands and execute the automated checks; record results and any checks blocked by the environment.
- [x] 5.4 End the two-day spike with a decision report covering adopt/reject/further-investigation, integration effort, evidence and unresolved blockers; identify a follow-up Sprotty experiment if warranted. Leave incomplete implementation tasks unchecked and explicitly documented if the timebox expires.

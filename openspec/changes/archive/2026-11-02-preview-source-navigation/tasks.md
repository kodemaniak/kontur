## 1. Specify behavior with failing tests

- [x] 1.1 Add focused failing tests for converting Rust source locations to VS Code positions, including supplementary Unicode, multiline/CRLF ranges, invalid locations, and overlapping nested declarations; run them and record the intended failures.
- [x] 1.2 Add failing preview browser tests for stable-ID mapping, single-click selection without navigation, double-click and Enter navigation requests, and drag-to-pan without navigation; run them and record the intended failures.
- [x] 1.3 Add failing extension-host tests for current-bound-document resolution, strict ID/revision validation, editor cursor highlighting and clearing, stale-map rejection, and highlight recovery after a valid result; run them and record the intended failures.
- [x] 1.4 Extend packaged VS Code acceptance coverage for unsaved DSL navigation/highlighting, Unicode-correct ranges, stale preview behavior, and valid recovery; establish the expected failures before implementation.

## 2. Implement host-side source mapping

- [x] 2.1 Implement the smallest source-location conversion and innermost-visible-range matching that makes the focused tests pass, using the bound unsaved `TextDocument` and rejecting mismatched or invalid ranges rather than clamping them.
- [x] 2.2 Refactor the mapping code with its focused tests still passing; keep source interpretation in the VS Code host and leave the Rust model/preview JSON schema unchanged.

## 3. Implement bidirectional preview interactions

- [x] 3.1 Add a revisioned, ID-only webview navigation request and strict extension-host handling against the current valid source map; reveal/select the bound document's source range and reject unknown, stale, malformed, or path-bearing messages.
- [x] 3.2 Associate rendered Mermaid node and boundary groups with stable domain IDs in the preview adapter; implement single-click selection, double-click navigation, Enter activation, and pan-versus-click handling without exposing Mermaid IDs as semantic identities.
- [x] 3.3 Forward bound-editor cursor mapping to the current rendered revision, clear the source highlight when there is no visible match, and avoid feedback loops between editor and webview selection.
- [x] 3.4 Invalidate source interactions as soon as a newer revision is pending or invalid; retain the last-valid diagram as stale, then replace its map and reevaluate the cursor after a successful current result.
- [x] 3.5 Refactor the message and interaction flow with focused tests passing; retain strict message validation and keep paths/ranges out of webview requests.

## 4. Verify end-to-end behavior and document scope

- [x] 4.1 Make the packaged VS Code acceptance tests pass for navigation, highlighting, single-file unsaved edits, Unicode positions, stale rejection and recovery; confirm navigation never saves or edits the DSL.
- [x] 4.2 Update the root README, supported-subset/VS Code documentation and repository milestone notes to describe the delivered source navigation and its limits (no relationship-edge or multi-file navigation).
- [x] 4.3 Run `cargo fmt --all -- --check`, `cargo clippy --locked --workspace --all-targets -- -D warnings`, `cargo test --locked --workspace`, `npm run verify` in `apps/preview`, and `npm run typecheck && npm run test:unit && xvfb-run --auto-servernum npm run test:vsix` in `apps/vscode`; report any unavailable checks or remaining limits.

# VS Code Extension Packaging

## Purpose

Specify the self-contained Linux x64 VSIX, its native-platform boundary, license delivery and installed-artifact verification.

## Requirements

### Requirement: Self-contained offline platform package
A documented locked build SHALL produce an installable `linux-x64` VSIX containing the release-mode `x86_64-unknown-linux-gnu` executable, extension-host code, Mermaid browser code, styles and all runtime assets. Runtime SHALL require no Cargo, separately installed Node.js, development server, external binary/assets download, network access, account or service. The product Vite server/build wiring SHALL be replaced by static asset bundling; test-only tooling SHALL NOT be required by or shipped as the extension runtime. Package-content checks SHALL verify required resources and the executable permission and exclude unrelated development artifacts.

#### Scenario: Install without the development toolchain
- **WHEN** the VSIX is installed on its documented supported Linux baseline and the preview is opened without Cargo, separate Node.js or network access
- **THEN** the bundled process and webview render the DSL without starting a Vite/Axum server or fetching missing assets

### Requirement: Honest platform support boundary
The VSIX SHALL declare VS Code target `linux-x64`, and its native build target and Linux/glibc baseline SHALL be documented and tested. The extension SHALL check the extension host's OS/CPU before spawning and report an unsupported environment rather than attempting an incompatible executable. The release SHALL NOT claim macOS, Windows, ARM, Alpine/musl, browser-only VS Code or verified remote-development support. No runtime executable discovery/downloader or all-platform binary collection SHALL be required. Packaging configuration SHALL keep platform selection explicit so future supported targets can ship matching binaries under the same extension identity.

#### Scenario: Wrong platform is not silently accepted
- **WHEN** the package or its process-start boundary is evaluated on an unsupported OS/CPU
- **THEN** installation compatibility or the runtime platform guard rejects it clearly and no incompatible native process is launched

#### Scenario: Platform label is not libc compatibility proof
- **WHEN** a Linux x64 release is prepared
- **THEN** its documented libc baseline and installed smoke-test evidence accompany the artifact rather than a claim of support for every Linux x64 distribution

### Requirement: License and corresponding-source delivery
The VSIX SHALL include Kontur's MIT license plus the required license texts, copyright/NOTICE content and source references for distributed Rust and JavaScript dependencies, using their actual locked versions. For distributed ELK code it SHALL use the EPL-2.0 option and include corresponding-source instructions and source for any distributed ELK modifications. The complete package SHALL NOT be described as MIT-only. Package checks SHALL verify notice inclusion rather than relying on notices outside the artifact.

#### Scenario: Inspect the distributable
- **WHEN** the generated VSIX is inspected
- **THEN** the native executable and browser assets are accompanied by their required notices, including Mermaid/transitive ELK licensing and corresponding-source instructions

### Requirement: Installed extension acceptance and reproducible verification
Verification SHALL cover the built VSIX in real desktop VS Code on the supported baseline, not only an unpackaged development extension or browser harness. It SHALL exercise command activation, initial rendering, an unsaved relationship edit, invalid-input retention, valid recovery, pan/zoom continuity and native-process shutdown. A documented automated smoke command and CI integration SHALL be provided where the desktop environment supports it; any manual-only check or blocked execution SHALL be reported with evidence and SHALL NOT be counted as an automated pass. Rust/npm dependencies and tool versions SHALL be pinned or locked, and build/test downloads SHALL occur only during developer/CI setup.

#### Scenario: Complete local modeling roundtrip
- **WHEN** a user installs the package, opens this repository, selects the example, runs Open Preview and edits a relationship without saving
- **THEN** the new relationship text appears directly in VS Code without a terminal command or browser switch; invalid/corrected follow-up edits show stale/recovered states and closing the preview stops its child

#### Scenario: Browser success cannot substitute for installed acceptance
- **WHEN** browser tests pass but real VS Code/VSIX execution is unavailable
- **THEN** the handoff lists the installed smoke as unverified and does not claim the installable preview acceptance has passed

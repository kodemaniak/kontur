# Kontur for VS Code

Local architecture preview for Kontur DSL workspaces.

This extension is initially packaged for Linux x64. Its Rust executable and offline webview assets are bundled in the VSIX.

In the live preview, single-click a person, container or system boundary to select it. Double-click or press Enter on a focused item to select its source declaration; moving the editor cursor highlights the narrowest matching visible declaration. Stale previews remain visible but are not navigable. Relationship edges and declarations outside the selected view are not navigation targets; only one local `.dsl` file is supported.

The Linux binary is built and smoke-tested on Ubuntu 26.04.1 x86-64 with glibc 2.43. Alpine/musl and other operating systems or architectures are not supported yet. The extension needs neither Cargo nor a separate Node.js installation at runtime.

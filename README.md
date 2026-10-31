# kontur

**Make architecture visible.**

Kontur is an open-source project for C4-based software architecture as code. Its goal is to make architecture models easy to describe, validate, and explore interactively within the IDE — initially locally for an individual or team, and later across multiple Git repositories.

The project is in the planning and initial setup phase. The following sections describe intended capabilities, not features that are already available.

## Vision

Architecture descriptions should be maintained like source code: as text, versioned and reviewed through Git. A shared model provides different views of systems, containers, and their relationships.

Kontur aims to bring together three things:

- **Usability:** Modeling in VS Code with language support, clear diagnostics, and a local live preview.
- **Traceable architecture:** Git-versioned files remain the authoritative source. Diagrams and future central indexes are derived from them.
- **AI assistance:** Assistants should be able to understand and inspect models through MCP and prepare changes. Changes are made to source files and follow the normal Git review workflow.

The long-term goal is a federated architecture repository: teams maintain their models independently, while a consolidated view reveals relationships across teams.

## Core principles

- **Local first:** Modeling and visualization work offline, without an account or central service.
- **Our own Rust core:** The parser, architecture model, reference resolution, validation, and language server are developed in Rust.
- **Structurizr DSL as the first input format:** Kontur uses its own implementation and depends on neither the Structurizr server nor its libraries. Initial support covers a documented language subset; unsupported syntax produces explicit diagnostics.
- **One shared core:** VS Code support, the CLI, and the future service share model processing and validation.
- **Separate model and presentation:** The semantic architecture model remains independent of layout and visualization. Existing libraries will handle rendering and layout.
- **Open source throughout:** All product components are released under the [MIT license](LICENSE).

## Roadmap

| Phase | Goal |
| --- | --- |
| **1. Local modeling** | Describe, validate, and visualize architecture in a local workspace within VS Code. |
| **2. Local AI assistance** | Query models, check consistency, and prepare changes to local files through MCP. |
| **3. Reference external models** | Include other teams' architecture workspaces from Git repositories at pinned versions. |
| **4. Consolidated central view** | Aggregate team models and explore them through search, a web interface, and read-only MCP access. |

## Current focus: local modeling

The first milestone focuses on a local workspace for an individual or team. A model may span multiple files.

Planned capabilities include:

- An initial DSL subset covering people, software systems, containers, relationships, basic metadata, and views.
- Our own language server with diagnostics, completion, hover information, and go-to-definition.
- A VS Code extension with a local live preview, view selection, pan and zoom, and navigation between diagrams and source code.
- Preview updates for unsaved changes. When input is invalid, the last valid visualization remains visible and is marked as stale.
- Diagram layouts that remain as stable as possible while editing.
- A local validation CLI whose checks can also run in a Git-based CI pipeline.

**First acceptance scenario:** A team opens its repository in VS Code, describes two systems with containers and labeled relationships, and visualizes and edits them locally. Diagnostics are clear, and diagram elements link back to their definitions in the source code.

## Technical direction

The Rust core maintains the architecture model, stable element identities, and source locations. The browser-based visualization should be reusable in both a VS Code webview and the future web interface.

The visualization and layout libraries, as well as the packaging of the local core, are still undecided. React Flow with ELK.js is one candidate; Mermaid has been discussed as a possible prototype or export option. The decision will be based on a small prototype with nested containers, labeled relationships, and model updates.

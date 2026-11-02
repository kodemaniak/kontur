# Supported Structurizr DSL subset

Kontur implements this subset itself using the private Pest grammar in `crates/kontur-core/src/parser.pest`. It is not a complete Structurizr DSL parser. Syntax outside this list fails with a diagnostic; it is never silently dropped.

## Workspace shape

One file contains one named workspace, one model and one explicitly keyed container view. The subset requires `!impliedRelationships false` because implied relationships are not implemented. Identifiers use Structurizr's default flat scope and the ASCII letters, digits and underscore. Element and relationship IDs must be explicit.

```structurizr
workspace "Example" {
    !impliedRelationships false

    model {
        user = person "User" "Description"
        system = softwareSystem "System" "Description" {
            app = container "Application" "Description" "Rust · HTTP/JSON"
            database = container "Database" "Stores records" "PostgreSQL" {
                tags "Database"
            }
        }
        uses_app = user -> app "Uses the application"
        stores_records = app -> database "Reads and writes records" "SQL"
    }

    views {
        container system "system-containers" {
            include user app database
            autoLayout lr
        }
    }
}
```

The view scope is a declared software system. Its explicit include list can contain people and containers, including containers owned by another system. Selecting a container adds its system boundary, but does not add its sibling containers. A relationship is displayed exactly when both endpoints are selected. A database is a regular container with the `Database` tag.

## Supported declarations

- `id = person "name" ["description"]`
- `id = softwareSystem "name" ["description"] { ...containers... }`
- `id = container "name" ["description"] ["technology"] [ { tags "Tag[,Tag...]" } ]`
- `relationship_id = source_id -> target_id "description" ["technology"]`
- `container softwareSystem_id "view-key" { include id [id ...] [autoLayout lr] }`

People and systems may have descriptions. Containers may have a description and technology. Relationships require a description and may have technology. Names and metadata are double-quoted. `\"` and `\\` are the supported escapes. `//` line comments and `/* ... */` block comments are supported; line endings may be LF or CRLF.

## Not supported

Anonymous declarations, hierarchical identifiers, `!include`, other workspace directives, implied relationships, relationship tags/properties, components, deployment models/views, other view kinds, `include *`, expressions, `exclude`, styles, scripts, manual layout, multiple files and full error recovery are not supported. These constructs return explicit unsupported-feature diagnostics where recognized; malformed syntax returns syntax diagnostics. No input is accepted partially.

`autoLayout lr` is a renderer-neutral layout direction hint. The core does not calculate positions or generate Mermaid.

## VS Code preview scope

On Linux x64, install the packaged Kontur extension, open a local `.dsl` file and run **Kontur: Open Preview**. The preview follows that file's unsaved edits, reports diagnostics, keeps the last valid diagram visible and marked stale after invalid input, and retains the viewport across edits and webview recreation. Single-click a person, container or system boundary to select it in the diagram; double-click or focus it and press Enter to navigate to its declaration. Moving the editor cursor highlights the narrowest matching visible declaration. Stale diagrams are not navigable and do not provide source-driven highlights. The Rust core selects the file's single declared view; there is no view picker, LSP or multi-file workspace support in this slice. Relationship edges are not navigation targets. The extension bundles its Rust service and web assets and does not need a local server, Cargo, separately installed Node.js or network access at runtime. The documented package baseline is Ubuntu 26.04.1 x86-64 with glibc 2.43; musl/Alpine and other host architectures are not supported.

# Kontur DSL Lab

An experimental, browser-only Kontur DSL to Mermaid playground. The DSL parser,
semantic checks, model projections, and Mermaid renderer run entirely in the
browser. There is no application backend or model upload.

## Development

```sh
# From apps/playground in the Kontur checkout
rustup target add wasm32-unknown-unknown
npm ci --prefix ../preview
npm ci
npm test
npm run build
node tests/wasm-parity.mjs
```

Serve the generated `dist/` directory from a local static web server.

The **Rust-Vorschau** link opens the Orders & Payments container view with the
same Rust compiler and Mermaid presenter used by VS Code. It runs as WebAssembly
in the browser and accepts edits to the example DSL. Harbor Books still uses the
JavaScript pipeline while its syntax and views are ported.

## Harbor Books example

The default source selection combines three repositories in the same namespace:

| Repository | What it models |
| --- | --- |
| `demo/bookshop` | Bookshop and shipping, browser and service containers, checkout components, REST operations and Kafka topics |
| `demo/bookshop-platform` | Platform ownership, capabilities and environments. In the technical views, switch between `dev`, `stage` and `prod` to see the bindings. |
| `demo/bookshop-operations` | External fulfillment operations and source-attributed responsibilities. Clara Nguyen's technical ownership is confirmed by both the application and operations repositories. |

Select `demo/bookshop-inventory` together with `demo/bookshop` to see an
intentional reconciliation conflict. The application declares React for the
storefront and the inventory reports Vue. The default selection has no conflicts.

## Supported experimental subset

- Workspace and namespace
- Organizations, teams, named people, business processes, and source-attributed responsibilities
- C4-style systems, containers, components, and actors
- `service` and `datastore` as container aliases with semantic kinds
- First-class APIs with protocol, style, interaction, lifecycle, owner,
  and a reference to a contract (OpenAPI, Protobuf, AsyncAPI, etc.)
- Typed `provides`, `consumes`, `publishes`, `subscribes`, and `dependsOn`
  relationships; `consumes` may list selected operation IDs
- Produced and consumed topics on event APIs, with optional topic selection on publish/subscribe relationships
- Organization and business-process relationships with optional source attribution
- Platforms, capabilities, application stages and bindings to platform environments
- `landscape`, `containers`, `components`, `apis`, `ownership`,
  `deployment`, `platformCapabilities`, and `technicalDependencies` views
- Local multi-source simulation with Git repository and revision labels, namespace-qualified identities, shared claims, and an assertion conflict report
- Local diagnostics, live Mermaid generation, SVG and DSL download,
  and local storage

The Bookshop deployment views map named system and container instances onto
nested deployment nodes, including Kubernetes namespaces and external
infrastructure. A view selects its topology with `environment` and its API
bindings with `stage`. A deployment node can explicitly reference a platform
environment with `runsIn`. The in-app language reference includes the syntax.

Contract files are *references only* in this version: their contents are not
loaded or validated. The web DSL is a design prototype, **not** the production
Rust parser or a claim of full Structurizr DSL support.

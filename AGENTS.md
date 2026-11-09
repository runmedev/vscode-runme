# Repository Instructions

## Generated protocol dependencies

- Treat `@buf/*` compatibility per generated-code stack, not across the entire namespace.
- Keep `*.community_timostamm-protobuf-ts`, `*.connectrpc_es`, and `*.bufbuild_es` packages on their respective current major versions unless a major upgrade is explicitly requested.
- Keep packages generated from the same source module, such as `@buf/runmedev_runme.*`, on the same source revision across generator families, including transitive copies.
- Update related generated packages and their corresponding runtime dependencies together, and verify the resolved dependency graph remains compatible before committing.

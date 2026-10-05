# Anti-slop provenance

- Source repository: https://github.com/dmmulroy/anti-slop
- Copied from: `.agents/skills/install-anti-slop/assets/anti-slop/` using the bundled installer.
- Exact upstream commit: unknown. The skill lock records computed hash
  `4031728fbe75bdcad6ee3208fd52b5d66e167b056fefee1fa9758e9a6cb9c0c8`;
  this is not a verified upstream commit or plugin snapshot identity.
- Installed entry points: `tools/oxlint/anti-slop/index.ts` and
  `tools/oxlint/anti-slop/effect/index.ts`.
- Plugin code deviations: none; vendored Stylistic license and provenance retained.
- The adjacent MIT license is from upstream `main/LICENSE`, retrieved October 5,
  2026. It covers this third-party tooling, not Camenae-authored application code.
- Local configuration: `.oxlintrc.json` enables all bundled generic and Effect
  rules plus `oxc/no-accumulating-spread` at error severity. It excludes `docs/**`,
  agent tooling directories, and this vendored plugin.
- Existing exact dependency pins preserved: `oxlint` and `@oxlint/plugins` 1.86.0.

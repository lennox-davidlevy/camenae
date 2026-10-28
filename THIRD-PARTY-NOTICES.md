# Licensing and third-party notices

## Camenae-authored source

This repository does not currently declare an application license. Cleanup does
not select one or apply Camenae SDK's license to the app. Decide an app license
explicitly before publishing it as open source. `private: true` prevents accidental
package publication; it is not a license. No third-party license below grants
rights in Camenae-authored code or in a bundled provider runtime.

## Included assets and tooling

- Geist fonts: [SIL OFL notice](src/ui/fonts/geist-OFL.txt).
- Geist Mono fonts: [SIL OFL notice](src/ui/fonts/geistmono-OFL.txt).
- Gloock font: [SIL OFL notice](src/ui/fonts/gloock-OFL.txt).
- Anti-slop lint plugins: [MIT license](tools/oxlint/anti-slop/LICENSE) and
  [provenance](tools/oxlint/anti-slop/UPSTREAM.md). The original installed snapshot's
  exact upstream commit is unknown; the provenance records that limitation.
- Vendored ESLint Stylistic code: [MIT license](tools/oxlint/anti-slop/vendor/eslint-stylistic/LICENSE)
  and [upstream/modification record](tools/oxlint/anti-slop/vendor/eslint-stylistic/UPSTREAM.md).

The UI coin artwork at `src/ui/assets/camenae-coin.png` is retained from the existing
application; no separate asset license/provenance was found. Confirm rights to
publish it alongside the application licensing decision. Source export is not
legal clearance or permission to distribute someone else's work.

## Installed dependencies and images

Dependency versions are recorded in `package.json` and `bun.lock`; installed
packages retain their own licenses/notices. Container bases and downloaded build
dependencies are separately licensed. Audit the contents/obligations before
distributing images; an app source license is not a blanket image license.

The approved `@camenae/opencode` archive is compiled SDK code delivered outside this
repository. Preserve any license files it contains when consuming it. The archive,
its runtime, dependency install output, and built images are **not** included in
the source-only export. Obtain them through authorized delivery and assess their
redistribution terms separately; do not infer rights from the SDK-authored code's
license or copy them into a new public repository.

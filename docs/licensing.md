# Licensing and source releases

Clockoli is free software under GPLv3. Each release comes with license notices and a matching source archive.

The original Clockoli code and TaskTimeline are copyright © 2026
**Manticore Software LTD** (https://manticoresearch.com). See
[COPYRIGHT](../COPYRIGHT) for the ownership notice. Third-party files
retain their respective copyrights.

Clockoli's original source code is licensed under the **GNU General Public
License, version 3 only** (`GPL-3.0-only`); see [LICENSE](../LICENSE).

There is currently **no proprietary-plugin exception** to this license.
A separate add-on using its own license must be evaluated against the
actual integration and distribution architecture. The current first-party
Clockify add-on is packaged within the extension.

Third-party components retain their own licenses and notices. See
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and [LICENSES](../LICENSES).

`LICENSES/PDF-npm-dependencies.txt` contains the full LICENSE/NOTICE text of
all 23 upstream production dependencies. The CI source-archive check
regenerates this file from the pinned installed npm packages and fails if
anything changes or is missing. It is included in each browser package.

## Corresponding Source for browser packages

Each release should offer the `Clockoli-<version>-source.zip` archive at the
same public release location as its Chrome, Firefox, and Safari packages.
The archive contains:

1. Clockoli's **selected Corresponding Source** from the exact tagged Git commit:
   runtime code, tests, build tools, and licensing files (including the source
   used to build its generated TaskTimeline script). Internal project-management
   files such as `AGENTS.md` and `IMPLEMENTATION_PLAN.md` are deliberately
   excluded; the archive uses an explicit source-path allowlist.
2. The pinned **html2pdf.js v0.14.0** upstream source tree at commit
   `29a31027d105782f10918bbf7fcada67488199dc`, including upstream build
   configuration, package-lock.json, source maps, and notices.
3. The **production npm dependency package trees** installed from that
   upstream lockfile with `npm ci --omit=dev --ignore-scripts`. These are
   supplied under `third_party/html2pdf.js-v0.14.0/node_modules/`, including
   their own licenses and source files.
4. **Full pinned upstream Git source snapshots for 13 production packages** whose
   npm distributions can contain compiled or generated JavaScript rather than
   the preferred editable source. These include jsPDF, html2canvas, DOMPurify,
   canvg, and their compiled transitive dependencies. The snapshots live under
   `third_party/pdf-source-repositories/<package>-<version>/`, retaining their
   original source, build configuration, lockfile (where provided), and licenses.
   `scripts/pdf-upstream-sources.json` records the exact upstream commit, package
   version, and required editable source file for each snapshot. Packaging fails
   if an upstream tag moves, a version differs from the production lockfile, or
   a required source file is missing.

The source ZIP is generated with:

```sh
python3 scripts/package-source.py HEAD /tmp/Clockoli-0.3.0-source.zip
```

On a tagged release, pass the release tag rather than `HEAD`. The command
**requires a clean checkout at the exact ref**, scans archived Clockoli files for
common secret patterns, and checks the vendored PDF code from that same Git archive.
Manual Firefox signing also refuses a dirty checkout.
The packaging script needs network access to GitHub and npm during creation;
recipients of the finished source archive do **not** need those services to
inspect the bundled source files.

The released PDF runtime bundle is based on upstream
`dist/html2pdf.bundle.min.js`, with one replacement for Chrome Manifest V3.
The source archive contains both the corresponding upstream build inputs and
the Clockoli patch-verification script. To verify against a local copy of
the upstream v0.14.0 bundle:

```sh
node scripts/verify-html2pdf-source.mjs \
  third_party/html2pdf.js-v0.14.0/dist/html2pdf.bundle.min.js
```

The script checks both expected SHA-256 hashes and the exact substitution;
this is stronger than accepting any bundle with a plausible version label.

The matching source ZIP must remain accessible to recipients for as long as
that browser release is distributed. Builds and GitHub Releases may be created
in private repositories, but private GitHub Release assets are not publicly
accessible. If distributing binaries through a public browser store, provide
those recipients with a public matching source ZIP (for example, in the new
public repository) and link it from the store listing or distribution notes.

## Rebuilding the modified HTML-to-PDF bundle

The matching source ZIP includes the pinned html2pdf.js source, its lockfile,
production dependency packages, editable snapshots for dependencies that ship
compiled JavaScript, and Clockoli's Manifest V3 patch.

**For Mozilla AMO reviewers and release verification**, use Node.js 22 and run:

```sh
python3 scripts/verify-pdf-rebuild.py /path/to/Clockoli-X.Y.Z-source.zip
```

The verifier extracts the **actual released source ZIP** into a temporary
directory, reinstalls the exact upstream development dependencies using
`npm ci --include=dev --ignore-scripts`, and runs the upstream Webpack build.
It byte-compares both the freshly rebuilt minified bundle and its upstream
license report with the pinned official distribution, applies the documented
`Function("return this")()` to `{}` Manifest V3 substitution, and
byte-compares the final result with the file shipped in Clockoli.

The upstream Webpack configuration normally puts the **current year** into its
copyright banner. For reproducibility across calendar years, the verifier pins
only this banner year to the year in the archived official upstream license
report before rebuilding. It does **not** modify runtime source code, dependency
versions, minifier settings, or generated output to force a match. Any other
difference fails verification with a byte offset and both SHA-256 values.

The source archive already contains the official upstream distribution. To
verify just the fixed upstream package and the documented modification without
rebuilding, run:

```sh
node scripts/verify-html2pdf-source.mjs \
  third_party/html2pdf.js-v0.14.0/dist/html2pdf.bundle.min.js
```

The rebuild requires npm network access to download the upstream **build**
dependencies from the pinned lockfile. The source ZIP also provides the
upstream source snapshots and licenses; no development npm packages are
preinstalled there. CI runs the same exact rebuild for pull requests and
tagged releases. The license file `LICENSES/PDF-npm-dependencies.txt`
is checked separately against the installed production packages.


## Contributions and future licensing

Copyright owners may distribute their own code under additional licenses.
However, the project must obtain sufficient explicit rights from **outside**
contributors before relicensing their contributions or granting an exception
that covers their code. Do not assume an ordinary pull request constitutes
copyright assignment or consent to commercial relicensing; see
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Brand

The GPL grants copyright permissions for code and copyrightable assets
covered by that license. It does not grant trademark rights to use the
`Clockoli` name or logo to suggest sponsorship or endorsement by the
official project. Avoid representing forks as official Clockoli releases.

## Mac App Store

When the Apple signing environment is fully configured, the Safari build also
exports `Clockoli-X.Y.Z-safari.pkg` for possible **manual** submission through
Transporter / App Store Connect. Producing or publishing this package as a
downloadable GitHub Release asset is not the same as uploading or submitting it
to Apple's store; the build has no such submission step.

Before distributing the GPLv3 application through the Mac App Store, review
the applicable store terms and obtain any additional permissions needed.
Creating a `.pkg` does not itself establish that the subsequent distribution
would comply with those terms. Direct signed and notarized Safari distribution
outside the store remains available.

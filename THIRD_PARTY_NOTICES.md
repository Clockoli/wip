# Third-party notices

Clockoli's original source code is licensed under **GPL-3.0-only** (see [LICENSE](LICENSE)).
Third-party code retains its own copyright and licensing terms; the GPL declaration
does not relicense any of the components listed below.

## PDF export: html2pdf.js and embedded dependencies

- **html2pdf.js 0.14.0** — Copyright © Erik Koopmans; MIT.
  Source: https://github.com/eKoopmans/html2pdf.js/tree/v0.14.0
  Pinned upstream commit: `29a31027d105782f10918bbf7fcada67488199dc`.
- **html2canvas 1.4.1** — Copyright © Niklas von Hertzen and contributors; MIT.
  Complete notice: [LICENSES/html2canvas-MIT.txt](LICENSES/html2canvas-MIT.txt).
- **jsPDF 4.0.0** — Copyright © James Hall, yWorks GmbH, and contributors; MIT.
  Complete notice: [LICENSES/jsPDF-MIT.txt](LICENSES/jsPDF-MIT.txt).
- **pako 2.1.0** — Copyright © Vitaly Puzrin, Andrey Tupitsin, and contributors;
  MIT for its own files and Zlib for the ported zlib code.
  Complete terms: [pako MIT](LICENSES/pako-MIT.txt) and
  [Zlib](LICENSES/Zlib.txt).
- **DOMPurify 3.3.1** — Copyright © Cure53 and contributors; licensed under
  Apache-2.0 OR MPL-2.0. Clockoli uses the **Apache-2.0 option**; the complete
  Apache-2.0 license is in [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt).
- **Complete production dependency notices:** full upstream LICENSE and
  NOTICE files for all **23** lockfile-pinned installed production packages
  (including canvg, core-js, fflate, and image and PDF helpers) are reproduced
  in [LICENSES/PDF-npm-dependencies.txt](LICENSES/PDF-npm-dependencies.txt).
  This list intentionally includes optional and type packages, even if not
  present in the actual minified bundle. CI regenerates and compares the
  notice file against the archived npm package sources.
  The original upstream Webpack license report is also preserved in
  [src/vendor/html2pdf.LICENSE.txt](src/vendor/html2pdf.LICENSE.txt).

The distributed `src/vendor/html2pdf.bundle.min.js` is a byte-for-byte copy of
the upstream v0.14.0 distribution, **except for one MV3-compatible substitution**:
`Function("return this")()` becomes `{}` in the legacy core-js global fallback.
This does not alter the PDF renderer's other code.

- Upstream bundle SHA-256: `9563c45f032179c73454293a649929e60fc24c05a326e8ab2811cfa8f25c3607`
- Clockoli bundle SHA-256: `2be8dd6f51226c102898621d20c355cf4da81d596846622ddb13b5b55709496e`

Use `node scripts/verify-html2pdf-source.mjs PATH_TO_UPSTREAM_BUNDLE` to check
the upstream checksum, the **exact single-byte-sequence change**, and the
resulting vendored checksum. This provides an audit trail for the modification.

The per-version **Clockoli source ZIP** published alongside the browser
packages contains the matching html2pdf.js v0.14.0 upstream source tree,
build configuration, package lockfile, and installed production dependency
packages. See [docs/licensing.md](docs/licensing.md) for how to obtain or
regenerate it.

The HTML-to-PDF license report contains additional attributions from the
upstream bundle, including permissively licensed code that does not have
a standardized SPDX identifier. Those notices must remain intact.

## GitHub Primer-inspired design tokens

`src/styles/github-primer.css` adapts CSS variables and design tokens from
[Primer Primitives](https://github.com/primer/primitives).

Copyright © 2018 GitHub Inc.; MIT.
Complete license: [LICENSES/Primer-MIT.txt](LICENSES/Primer-MIT.txt).

## Not bundled into browser releases

Development-only dependencies listed in `package-lock.json` are used for
testing, linting, and packaging. They are not shipped as runtime npm packages
inside the Clockoli browser extension.

## Clockoli-owned code

TaskTimeline under `packages/task-timeline-component/` and its generated
browser bundle are Clockoli-owned code, **not a third-party dependency**.

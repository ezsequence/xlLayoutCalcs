# xlLayoutCalcs

A TypeScript implementation of xLights model layout calculations.

Given a show directory's `xlights_rgbeffects.xml` and `xlights_networks.xml`,
this library computes what xLights itself would compute:

- Per-node geometry for every mainstream model type (arch, tree, matrix, star,
  polyline, custom, ...): buffer coordinates (the effect-rendering grid),
  model/screen coordinates, and world coordinates via each model's
  position/rotation transform
- Channel and string assignment, including resolved start channels and exact
  geometry-derived channel counts per model
- Controllers from `xlights_networks.xml`, with per-model RGB order and
  dimming info
- Layout groups, viewpoints, view objects, and layout settings
- A moving-head (DMX) engine: fixture definitions, channel data → physical
  state, and beam geometry per frame
- XML format migration between the legacy (`<2026.2`) and current (`>2026.3`)
  xLights layout formats, in both directions
- World-placement transforms: move, rotate, and scale a whole layout (or
  single models / view objects) by an affine matrix, rewriting every
  placement kind xLights has (boxed, two-point, three-point, poly line)

Both layout formats are read natively — model elements are normalized forward
on load, so legacy files need no pre-migration.

## Using

The build produces a single self-contained bundle (`dist/xlcoords.mjs`,
`dist/xlcoords.cjs`, `dist/xlcoords.d.ts`) whose only runtime dependency is
`gl-matrix`. The API takes standard DOM `Document`s — use the browser DOM, or
a library such as `@xmldom/xmldom` in Node. The full public API is exported
from [`src/index.ts`](src/index.ts) — start there; the code comments on the
exported functions and types are the integration documentation.

```sh
pnpm install
pnpm build
```

## How this repository works

This repository is a **mirror, published at release time**, of source that is
developed in a private repository. Development happens there because the
verification suite — the real value behind this code — runs against a large
corpus of real-world layouts and golden outputs captured from xLights itself,
much of which cannot be published. The test suite is therefore not included
in this mirror.

This is the live source used by the EZPlayer project (AGPL): the bundle
shipped by downstream releases is built from exactly the source you see here.

Because development happens elsewhere, pull requests cannot be merged here
directly — see [CONTRIBUTING.md](CONTRIBUTING.md), and prefer bug reports.

## License

Copyright ©EZSequence.

Licensed under the GNU Affero General Public License, version 3.0 only —
see [LICENSE](LICENSE). You are free to use, study, modify, and redistribute
this code under the AGPL's terms.

The copyright holder retains full rights to the source and separately offers
commercial (dual) licensing on request.

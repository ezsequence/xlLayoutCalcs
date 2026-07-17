# Contributing

## The short version

The most valuable contribution to this project is a **good bug report** — and
if you hit the problem in a downstream product (e.g. EZPlayer), reporting it
there is usually even better, since that is where it can be reproduced and
verified end-to-end.

## Why direct pull requests are hard here

This repository is a release-time mirror; development happens in a private
repository whose test suite verifies computed layouts against a proprietary
corpus of real-world show files and golden outputs captured from xLights.
That verification corpus is the heart of the project — this library is
largely a careful, behavior-verified port of xLights layout logic, and no
change lands without passing it.

Practical consequences:

- Pull requests here cannot be merged as-is. A maintainer will port an
  accepted change into the development repository, verify it against the
  corpus, and it will appear here in a subsequent release.
- The project is dual-licensed. By submitting a change you agree to grant the
  copyright holder the rights needed to redistribute it both under the AGPL
  and under the project's commercial licenses.

## What a great bug report looks like

- The smallest `xlights_rgbeffects.xml` (plus `xlights_networks.xml`, if
  channels/controllers are involved) that reproduces the problem
- What xLights shows or computes vs. what this library returns — model name,
  node index, buffer/world coordinates, or channel numbers
- The xLights version the layout was saved with

# Exploration Asset Tracking

A lightweight GitHub Pages dashboard for reviewing K-12 counselor exploration resources and tracking which assets have been used.

## Live dashboard

The site is published from this repository with GitHub Pages. It does not require a local server, PowerShell launcher, database, or build process.

## Data model

`data/assets.json` is the single canonical asset registry. It contains both newly discovered assets and previously used resources.

Each asset includes:

- title, publisher/source, category, summary, and URL
- a standardized asset type such as `Report`, `Article`, `Blog`, `Research`, `Resource`, or `Website`
- the closest known publication month/year
- review status: `pending`, `not_approved`, or `approved`
- whether it was used for an exploration activity and the date used

The weekly discovery task must check the complete registry before adding anything so previously reviewed or used assets are not rediscovered.

## Dashboard workflow

- **Review** contains assets that have not been marked used.
- **Used** contains assets with an exploration-use date.
- Open an asset to change its review status or record that it was used.
- Dashboard edits are saved in the current browser using local storage.

Because this is a static GitHub Pages site, browser edits do not write back to the repository. The JSON file remains the shared source for scheduled-task deduplication and the historical defaults shown by the dashboard. If cross-device editing is needed later, the project will need authenticated storage or a small backend.

## Repository structure

- `index.html` — self-contained dashboard
- `data/assets.json` — unified asset registry
- `.github/workflows/pages.yml` — GitHub Pages deployment

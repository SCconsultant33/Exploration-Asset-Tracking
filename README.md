# Exploration Asset Tracking

A lightweight GitHub Pages dashboard for reviewing K-12 counselor exploration resources and tracking which assets have been used.

## Live dashboard

The site is published from this repository with GitHub Pages. It does not require a local server, PowerShell launcher, database, paid hosting service, or build process.

## Durable dashboard saving

Dashboard edits can be committed directly to `data/assets.json` through GitHub's REST API.

1. Select **Connect GitHub** in the dashboard.
2. Create a fine-grained personal access token in GitHub.
3. Limit repository access to **Exploration-Asset-Tracking**.
4. Give it only **Contents: Read and write** permission.
5. Paste it into the dashboard connection dialog.

The token is stored only in the current tab's session storage, is sent only to `api.github.com`, and is removed when the tab session ends or **Disconnect** is selected. It is never written to this repository. Dashboard asset changes are committed permanently to the JSON registry and recorded in Git history.

If an edit is made before GitHub is connected, it is queued in browser storage and synchronized after a successful connection.

## Data model

`data/assets.json` is the single canonical asset registry. It contains both newly discovered assets and previously used resources.

Each asset includes:

- title, publisher/source, category, summary, and URL
- a standardized asset type such as `Report`, `Article`, `Blog`, `Research`, `Resource`, or `Website`
- the closest known publication month/year
- review status: `pending`, `not_approved`, or `approved`
- whether it was used for an exploration activity and the date used
- last update time and GitHub editor when changed through the dashboard

The weekly discovery task checks the complete registry before adding anything so previously reviewed or used assets are not rediscovered.

## Dashboard workflow

- **Review** contains assets that have not been marked used.
- **Used** contains assets with an exploration-use date.
- Open an asset to change its review status or record that it was used.
- Connected saves update the canonical JSON file and trigger a new GitHub Pages deployment.

## Repository structure

- `index.html` — self-contained dashboard
- `config.js` — public repository coordinates; contains no credentials
- `data/assets.json` — unified asset registry
- `.github/workflows/pages.yml` — GitHub Pages deployment

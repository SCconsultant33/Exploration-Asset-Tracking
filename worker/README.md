# Asset tracking write API

This Cloudflare Worker provides authenticated, durable dashboard saves to `data/assets.json`.

## Security model

- GitHub OAuth is used only to verify the editor's identity.
- Only the GitHub login in `ALLOWED_GITHUB_LOGIN` is accepted.
- A fine-grained GitHub token restricted to this repository performs JSON commits.
- Credentials remain in Cloudflare secrets and are never sent to the public dashboard.
- Updates are limited to review status, used/not-used, and date used.
- The current GitHub file SHA is checked on every update and a conflicting save is retried once.

## Required Worker secrets

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_CONTENT_TOKEN`
- `SESSION_SECRET`

Create the OAuth app after the first Worker deployment so its callback URL can be:

`https://<worker-host>/auth/callback`

The fine-grained content token should be limited to the `SCconsultant33/Exploration-Asset-Tracking` repository with **Contents: Read and write**. Do not commit any secret to this repository.

After deployment, set the Worker's public URL in the root `config.js` file.

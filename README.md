# Exploration Asset Tracking

A static dashboard for reviewing college, career, and military exploration resources collected for Michigan K-12 school counselors.

## Security model

This version does not require PowerShell, a local Node.js server, or any background process on the viewer's computer. It is designed to be hosted by GitHub Pages and reads the repository's `data/assets.json` file.

Review statuses and notes are stored in the viewer's browser using `localStorage`. They are not committed to GitHub yet. A later phase can add authenticated, shared review persistence.

## Data contract

`data/assets.json` contains:

```json
{
  "schema_version": "1.0",
  "assets": []
}
```

Each scheduled-task asset may contain `title`, `category`, `asset_type`, `source`, `published_date`, `url`, `summary`, `discovered_date`, `review_status`, and `report_file`.

## Publishing

The included GitHub Actions workflow deploys the repository as a static Pages site when Pages is enabled for GitHub Actions in the repository settings. Confirm your organization's access policy before deployment because Pages visibility can differ from repository visibility.

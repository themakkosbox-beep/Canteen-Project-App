# Camp Canteen POS

Camp Canteen POS is a Next.js + Electron application for managing prepaid canteen accounts, running both as a web app and a packaged Windows desktop experience.

## Features

- Customer lookup, quick keys, barcode scanning, deposits, adjustments, receipts
- Admin dashboard for importing/exporting customers and products
- Manual backup and restore tools with local data directory visibility
- Admin access code gating for sensitive operations like exports and settings
- SQLite-backed data layer powered by `sql.js`
- Windows desktop wrapper with auto-updates via GitHub releases
- Offline-friendly workflow using Electron and internal APIs

## Tech Stack

- Next.js 14, React 18, TypeScript, Tailwind CSS
- Headless UI and Heroicons for UI controls
- Fuse.js for fuzzy product search
- Electron 31 with electron-builder and electron-updater
- sql.js (SQLite compiled to WebAssembly)

## Prerequisites

- Node.js 18+
- npm 9+
- Windows for packaging the Electron desktop build
- GitHub personal access token with `contents: write` scope (for publishing releases)

## Local Development

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` to use the web experience. The Electron shell can wrap the dev server:

```bash
cd electron-app
npm install
npm run dev
```

## POS Shortcuts

- Ctrl+Shift+1: focus Customer ID
- Ctrl+Shift+2: focus Scan/Search
- Ctrl+Shift+3: focus Deposit amount
- Ctrl+Shift+4: open Adjustment and focus amount

## Production Build (Web)

```bash
npm run build
npm run start
```

## Release Pipeline

### 1. Prep and Verify

- Run the automated checks: `npm run lint` (root) and `npm run build` to ensure the Next.js bundle compiles cleanly.
- Optional but recommended: `cd electron-app; npm install; npm run lint` to confirm the shell packages without warnings (return to the root directory afterward).
- Confirm the point-of-sale discount preview UI renders the expected totals for a sanity check.

### 2. Version and Commit

- Bump the semver in both `package.json` files (root and `electron-app/`).
- Update any release notes or changelog entry if applicable.
- Stage the changes and create a release commit (for example, `git commit -am "chore: release vX.Y.Z"`).

### 3. Tag the Release

- Annotate the commit with a version tag: `git tag vX.Y.Z`.
- Push the branch and tag together: `git push origin master --follow-tags` (adjust branch name as needed).

### 4. Package and Publish the Desktop Build

- Ensure `GH_TOKEN` is set in the shell (`$env:GH_TOKEN = 'github_pat_...'`).
- Clean stale build artifacts when necessary: `Remove-Item -Recurse -Force .next`.
- Package and publish the Electron bundle:
   ```bash
   cd electron-app
   npm run package -- --publish always
   ```
- For local packaging without publishing, use `npm run package -- --publish never`.

### 5. Finalize the Release

- Review the draft GitHub release (`themakkosbox-beep/Canteen-Project-App`), attach additional assets if necessary, and publish the release.
- Once published, clients running the desktop build will download the update and prompt for restart after the installer completes.

## Environment Variables

- `NEXT_PUBLIC_APP_VERSION` - exposed in the UI for the footer badge (defaults to package version).
- `CANTEEN_DATA_DIR` - override the directory used to store `canteen.db` and backups.
- `CANTEEN_ADMIN_PEPPER` - optional pepper for admin code hashing (recommended for deployments).
- `GH_TOKEN` - required by `electron-builder` to upload releases to GitHub.

## Database Notes

The app uses `sql.js` with a SQLite file stored as `canteen.db`. By default this lives in `CANTEEN_DATA_DIR` (Electron sets it to the app `userData/data` directory). Automatic backups are stored under `backups/`, and manual backup/restore tools are available in Admin Settings.

## License

See `LICENSE` for proprietary usage terms.

# Camp Canteen POS

Camp Canteen POS is a Next.js + Electron application for managing prepaid canteen accounts, running both as a web app and a packaged Windows desktop experience.

## Features

- Customer lookup, quick keys, barcode scanning, deposits, adjustments, receipts
- Admin dashboard for importing/exporting customers and products
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

## Production Build (Web)

```bash
npm run build
npm run start
```

## Desktop Packaging & Auto-Update Workflow

1. **Bump versions** in both `package.json` files (root and `electron-app/`).
2. Ensure `GH_TOKEN` is set in the shell (`$env:GH_TOKEN = 'github_pat_…'`).
3. Clean stale artifacts when necessary: `Remove-Item -Recurse -Force .next`.
4. Package and publish:
   ```bash
   cd electron-app
   npm run package -- --publish always
   ```
5. Review the draft release on GitHub (`themakkosbox-beep/Canteen-Project-App`) and publish when ready.
6. Clients running the latest desktop build will download the update automatically and prompt to restart.

For local packaging without publishing, append `-- --publish never`.

## Environment Variables

- `NEXT_PUBLIC_APP_VERSION` – exposed in the UI for the footer badge (defaults to package version).
- `GH_TOKEN` – required by `electron-builder` to upload releases to GitHub.

## Database Notes

The app uses `sql.js` with an embedded SQLite file stored as `canteen.db`. In production builds the database is persisted alongside the Electron bundle.

## License

See `LICENSE` for proprietary usage terms.

# Camp Canteen POS Desktop Wrapper

This folder contains a lightweight Electron shell that wraps the existing Next.js Point-of-Sale project so the system can run like a native desktop program without opening a traditional browser.

## Prerequisites

- All dependencies for the root web project installed (`npm install` in the repository root).
- Node.js 18+ (bundled with Electron at runtime).

## First-Time Setup

```powershell
cd ..\electron-app
npm install
```

## Developer Workflow

1. Start the desktop app in development mode (Electron + Next dev server):
   ```powershell
   npm run dev
   ```
   This spawns `npm run dev` from the parent project, waits for `http://127.0.0.1:3000`, and loads it inside an Electron window. DevTools open automatically.

## Production Preview (offline)

1. Build the web application in the project root:
   ```powershell
   cd ..
   npm run build
   ```
2. Return to the Electron folder and launch in production mode:
   ```powershell
   cd electron-app
   node scripts/create-icon.js  # generate default icon once
   npm start
   ```
   The Electron shell boots the Next standalone server generated in `.next/standalone` and serves it inside a native window. No external browser or internet connection is required.

## Packaging (optional)

The project ships with `electron-builder`. After running the production build steps above:

```powershell
node scripts/create-icon.js  # ensure icon exists
npm run package
```

This command creates installers under `electron-app/dist/`. You can adjust the packaging targets by editing `electron-builder.yml` in this folder.

## Notes

- Run `node scripts/create-icon.js` whenever you want to regenerate the default blue camp icon (`assets/app-icon.ico`). Replace that file with your own `.ico` before packaging to customize branding.
- The desktop shell injects `PORT` and `HOSTNAME` so the Next server always listens on `127.0.0.1:3000`.
- When the Electron app closes it terminates the internal Next process to avoid orphaned Node instances.
- If you change API routes or add static assets, rebuild (`npm run build`) before launching production mode so the standalone bundle stays in sync.

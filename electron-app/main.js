'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { spawn, fork } = require('child_process');
const waitOn = require('wait-on');

const isDev = process.env.NODE_ENV === 'development';
const NEXT_PORT = Number(process.env.NEXT_PORT ?? 3000);
const NEXT_HOST = process.env.NEXT_HOST ?? '127.0.0.1';
let nextProcess;

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function startNextServer() {
  const rootDir = path.resolve(__dirname, '..');

  if (isDev) {
    const command = getNpmCommand();
    const args = ['run', 'dev'];

    nextProcess = spawn(command, args, {
      cwd: rootDir,
      env: {
        ...process.env,
        PORT: NEXT_PORT.toString(),
        HOSTNAME: NEXT_HOST,
      },
      stdio: 'inherit',
      shell: false,
    });
  } else {
    const standaloneDir = path.join(rootDir, '.next', 'standalone');
    const serverPath = path.join(standaloneDir, 'server.js');

    nextProcess = fork(serverPath, [], {
      cwd: standaloneDir,
      env: {
        ...process.env,
        PORT: NEXT_PORT.toString(),
        HOSTNAME: NEXT_HOST,
        NODE_ENV: 'production',
      },
      stdio: 'inherit',
    });
  }

  nextProcess.on('exit', (code) => {
    if (code !== 0) {
      const message = `Next.js process exited with code ${code ?? 'unknown'}`;
      console.error(message);
      dialog.showErrorBox('Server Error', message);
      app.quit();
    }
  });

  await waitOn({
    resources: [`http://${NEXT_HOST}:${NEXT_PORT}`],
    timeout: 60000,
    window: 1000,
    reverse: false,
    strictSSL: false,
    validateStatus: () => true,
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#f7fafc',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.on('closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  mainWindow.loadURL(`http://${NEXT_HOST}:${NEXT_PORT}`);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  return mainWindow;
}

function registerAutoUpdater(mainWindow) {
  if (isDev) {
    return;
  }

  autoUpdater.on('update-available', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: 'A new version is downloading in the background.',
    });
  });

  autoUpdater.on('update-not-available', () => {
    // Fail silently; users can ignore this.
  });

  autoUpdater.on('error', (error) => {
    console.error('Auto update error:', error);
  });

  autoUpdater.on('update-downloaded', () => {
    dialog
      .showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update Ready',
        message: 'An update has been downloaded. Restart now to apply it?',
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      })
      .catch((error) => {
        console.error('Failed to prompt for update restart:', error);
      });
  });

  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    console.error('Failed to check for updates:', error);
  });
}

async function bootstrap() {
  try {
    await startNextServer();
    const window = createWindow();
    registerAutoUpdater(window);
  } catch (error) {
    console.error('Failed to launch desktop app:', error);
    dialog.showErrorBox('Launch Error', error instanceof Error ? error.message : String(error));
    app.quit();
  }
}

app.on('ready', bootstrap);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (nextProcess && !nextProcess.killed) {
    nextProcess.kill();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

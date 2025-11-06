'use strict';

const fs = require('fs');
const { app, BrowserWindow, dialog, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { spawn, fork } = require('child_process');
const waitOn = require('wait-on');

const isDev = process.env.NODE_ENV === 'development';
const NEXT_PORT = Number(process.env.NEXT_PORT ?? 3000);
const NEXT_HOST = process.env.NEXT_HOST ?? '127.0.0.1';
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
let nextProcess;
let dataDirectory = null;

function applyApplicationMenu(_mainWindow, options = {}) {
  const {
    checkingForUpdates = false,
    updateReady = false,
    onCheckForUpdates = () => {},
    onInstallUpdate = () => {},
  } = options;

  const helpSubmenu = [
    {
      label: checkingForUpdates ? 'Checking for Updates…' : 'Check for Updates…',
      enabled: !checkingForUpdates,
      click: () => onCheckForUpdates(),
    },
  ];

  if (updateReady) {
    helpSubmenu.push({
      label: 'Install Downloaded Update…',
      click: () => onInstallUpdate(),
    });
  }

  helpSubmenu.push({ type: 'separator' });
  helpSubmenu.push({ role: 'toggleDevTools' });

  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: process.platform === 'darwin' ? [{ role: 'close' }] : [{ role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(process.platform === 'darwin'
          ? [{ role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'toggleFullScreen' },
      ],
    },
    {
      label: 'Help',
      submenu: helpSubmenu,
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

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

  applyApplicationMenu(mainWindow, {
    checkingForUpdates: false,
    updateReady: false,
    onCheckForUpdates: () => {},
    onInstallUpdate: () => {},
  });

  return mainWindow;
}

function registerAutoUpdater(mainWindow) {
  if (isDev) {
    applyApplicationMenu(mainWindow, {
      checkingForUpdates: false,
      updateReady: false,
      onCheckForUpdates: () => {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Updates Unavailable',
          message: 'Automatic updates are disabled while running in development mode.',
        });
      },
      onInstallUpdate: () => {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'No Update Ready',
          message: 'There is no downloaded update to install.',
        });
      },
    });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  let updateCheckTimer = null;
  let checkingForUpdates = false;
  let manualCheckActive = false;
  let updateReadyInfo = null;

  const clearUpdateTimer = () => {
    if (updateCheckTimer) {
      clearInterval(updateCheckTimer);
      updateCheckTimer = null;
    }
  };

  const presentInstallPrompt = () =>
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['Install and Restart', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update Ready',
        message: 'An update has been downloaded.',
        detail: 'Install now to restart immediately, or choose Later to finish from the Help menu when convenient.',
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        }
      })
      .catch((error) => {
        console.error('Failed to display update notification:', error);
      });

  const promptInstallUpdate = () => {
    if (!updateReadyInfo) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'No Update Ready',
        message: 'There is no downloaded update to install right now.',
      });
      return;
    }

    void presentInstallPrompt();
  };

  const refreshMenu = () => {
    applyApplicationMenu(mainWindow, {
      checkingForUpdates,
      updateReady: Boolean(updateReadyInfo),
      onCheckForUpdates: () => triggerUpdateCheck(true),
      onInstallUpdate: () => promptInstallUpdate(),
    });
  };

  const triggerUpdateCheck = (manual = false) => {
    if (checkingForUpdates) {
      if (manual) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Update Check in Progress',
          message: 'A software update check is already running. Please try again in a moment.',
        });
      }
      return;
    }

    checkingForUpdates = true;
    manualCheckActive = manual;
    refreshMenu();

    autoUpdater
      .checkForUpdates()
      .catch((error) => {
        console.error('Failed to check for updates:', error);
        if (manual) {
          dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'Update Check Failed',
            message: 'Unable to check for updates.',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
        checkingForUpdates = false;
        manualCheckActive = false;
        refreshMenu();
      });
  };

  const scheduleUpdateChecks = () => {
    clearUpdateTimer();
    updateCheckTimer = setInterval(() => {
      triggerUpdateCheck(false);
    }, UPDATE_CHECK_INTERVAL_MS);
    if (updateCheckTimer && typeof updateCheckTimer.unref === 'function') {
      updateCheckTimer.unref();
    }
  };

  autoUpdater.on('update-available', (info) => {
    checkingForUpdates = false;
    const wasManual = manualCheckActive;
    manualCheckActive = false;
    refreshMenu();

    const versionLabel = info && typeof info.version === 'string' ? `Version ${info.version}` : 'A new version';
    const message = wasManual
      ? `${versionLabel} is downloading now. You'll be prompted when it is ready to install.`
      : `${versionLabel} is downloading in the background.`;

    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message,
    });
  });

  autoUpdater.on('update-not-available', () => {
    const wasManual = manualCheckActive;
    checkingForUpdates = false;
    manualCheckActive = false;
    refreshMenu();

    if (wasManual) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Up to Date',
        message: 'You are already running the latest version of the application.',
      });
    }
  });

  autoUpdater.on('error', (error) => {
    console.error('Auto update error:', error);
    const wasManual = manualCheckActive;
    checkingForUpdates = false;
    manualCheckActive = false;
    refreshMenu();

    if (wasManual) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Update Error',
        message: 'An error occurred while checking for updates.',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    checkingForUpdates = false;
    manualCheckActive = false;
    updateReadyInfo = info ?? {};
    refreshMenu();
    clearUpdateTimer();

    void presentInstallPrompt();
  });

  mainWindow.on('closed', () => {
    clearUpdateTimer();
  });

  refreshMenu();
  triggerUpdateCheck(false);
  scheduleUpdateChecks();
}

async function bootstrap() {
  try {
    if (!isDev) {
      const userData = app.getPath('userData');
      dataDirectory = path.join(userData, 'data');
      try {
        fs.mkdirSync(dataDirectory, { recursive: true });
      } catch (error) {
        console.error('Failed to ensure data directory', error);
      }
      process.env.CANTEEN_DATA_DIR = dataDirectory;
    }

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

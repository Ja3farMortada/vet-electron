const {
    app,
    shell
} = require('electron');

/**
 * Built per-window so the tab actions can be injected.
 *
 * Reload / Force Reload / Toggle DevTools are NOT roles any more: roles act on
 * the focused window's webContents, which is now the tab strip. They have to be
 * pointed at the active tab instead.
 */
module.exports = (actions = {}) => [
    // { role: 'appMenu' }
    ...(process.platform === 'darwin' ? [{
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideothers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    // { role: 'fileMenu' }
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => actions.newTab?.()
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => actions.closeTab?.()
        },
        { type: 'separator' },
        {
          label: 'Next Tab',
          accelerator: 'Ctrl+Tab',
          click: () => actions.nextTab?.()
        },
        {
          label: 'Previous Tab',
          accelerator: 'Ctrl+Shift+Tab',
          click: () => actions.previousTab?.()
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    // { role: 'editMenu' }
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(process.platform === 'darwin' ? [
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
          { type: 'separator' },
          {
            label: 'Speech',
            submenu: [
              { role: 'startspeaking' },
              { role: 'stopspeaking' }
            ]
          }
        ] : [
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' }
        ])
      ]
    },
    // { role: 'viewMenu' }
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => actions.reload?.()
        },
        {
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => actions.forceReload?.()
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: () => actions.toggleDevTools?.()
        },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    // { role: 'windowMenu' }
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin' ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'About Developer',
          click: async () => {
            await shell.openExternal('https://electronjs.org')
          }
        }
      ]
    }
  ];
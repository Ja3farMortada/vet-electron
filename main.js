const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const path = require("path");

const buildMenuTemplate = require("./menu");
const { createTabManager } = require("./tabs");

// electron context menu
contextMenu = require("electron-context-menu");
contextMenu({
    showSaveImageAs: false,
    showSearchWithGoogle: false,
    showInspectElement: false,
    showSelectAll: false,
    showCopyImage: false,
});

// check if electron is in dev modea
const isEnvSet = "ELECTRON_IS_DEV" in process.env;
const getFromEnv = Number.parseInt(process.env.ELECTRON_IS_DEV, 10) === 1;
const isDev = isEnvSet ? getFromEnv : !app.isPackaged;

// Tab manager of the current window. IPC + auto-update handlers are registered
// once and resolve it lazily, so a re-created window keeps working.
let activeTabManager = null;

/**
 * Loads the app into a tab. Every tab loads the app from scratch, so it starts
 * on the home page — and because all tabs share the window's default session,
 * a new tab already has the same cookies/localStorage (so it is already logged
 * in and sees the same saved data), exactly like a new browser tab.
 */
function loadTab(webContents) {
    const load = () => {
        if (isDev) {
            webContents.loadURL("http://localhost:4200");
        } else {
            webContents.loadFile(path.join(__dirname, "app/browser/index.html"));
        }
    };

    webContents.on("did-fail-load", () => load());
    load();
}

async function createWindow() {
    // The window itself renders ONLY the tab strip; the pages live in
    // WebContentsViews stacked underneath it (see tabs.js).
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload-tabs.js"),
        },
    });
    win.maximize();
    win.show();

    win.loadFile(path.join(__dirname, "assets/tabs.html"));

    const tabManager = createTabManager(win, {
        loadTab,
        preload: path.join(__dirname, "preload.js"),
    });

    // The strip only exists once its page is ready to receive state.
    win.webContents.on("did-finish-load", () => {
        tabManager.sendState();
    });

    activeTabManager = tabManager;
    tabManager.newTab();

    // Menu needs the tab manager, so it is built per-window here rather than at
    // module load. Reload/DevTools must target the ACTIVE TAB — the roles would
    // otherwise hit the tab strip.
    Menu.setApplicationMenu(
        Menu.buildFromTemplate(
            buildMenuTemplate({
                newTab: () => tabManager.newTab(),
                closeTab: () => tabManager.closeActiveTab(),
                nextTab: () => tabManager.cycleTab(1),
                previousTab: () => tabManager.cycleTab(-1),
                reload: () => tabManager.getActiveWebContents()?.reload(),
                forceReload: () =>
                    tabManager.getActiveWebContents()?.reloadIgnoringCache(),
                toggleDevTools: () =>
                    tabManager.getActiveWebContents()?.toggleDevTools(),
            }),
        ),
    );
}

app.whenReady().then(async () => {
    // Registered ONCE, not per window: createWindow() can run again (macOS
    // "activate"), and ipcMain.handle throws if a channel is handled twice.
    // They resolve the tab manager lazily, so they always talk to the live one.
    ipcMain.on("tabs:new", () => activeTabManager?.newTab());
    ipcMain.on("tabs:select", (_event, id) => activeTabManager?.setActive(id));
    ipcMain.on("tabs:close", (_event, id) => activeTabManager?.closeTab(id));

    // update module — broadcast to every tab, not to the tab strip
    const updater = require("./update");
    updater(() => activeTabManager?.getAllWebContents() ?? [], ipcMain);

    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

// Open a URL in the user's default external browser. Used for wa.me links so
// WhatsApp gets the text via the browser (UTF-8) instead of an in-app window,
// which preserves emojis.
ipcMain.handle("open-external", async (event, url) => {
    await shell.openExternal(url);
});

// let printWindow;
ipcMain.handle("print-invoice", async (event, data) => {
    printWindow = new BrowserWindow({
        width: 706.95553,
        height: 1000,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
        },
    });

    printWindow.loadFile("assets/print.html");
    printWindow.show();

    const printOptions = {
        silent: false, // Print without showing a dialog (optional)
        marginsType: 0, // Set margin type (optional)
    };
    printWindow.webContents.on("did-finish-load", async function () {
        await printWindow.webContents.send("printDocument", data);
        printWindow.webContents.print(printOptions, (success) => {
            printWindow.close();
        });
    });
});

// print stock table
ipcMain.handle("print-stock", async (event, data) => {
    // console.log(data);
    printWindow = new BrowserWindow({
        width: 706.95553,
        height: 1000,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
        },
    });

    printWindow.loadFile("assets/stock.html");
    printWindow.show();

    const printOptions = {
        silent: false, // Print without showing a dialog (optional)
        marginsType: 0, // Set margin type (optional)
    };
    printWindow.webContents.on("did-finish-load", async function () {
        await printWindow.webContents.send("printDocument", data);
        printWindow.webContents.print(printOptions, (success) => {
            printWindow.close();
        });
    });
});

// label print
let labelPrint;
ipcMain.handle("label-print", async (event, data) => {
    labelPrint = new BrowserWindow({
        // width: 187,
        // height: 140,
        width: 230,
        height: 180,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
        },
    });
    // labelPrint.setMenu(null);
    labelPrint.loadFile("assets/labelPrint.html");
    // labelPrint.show();

    const printOptions = {
        silent: false,
        deviceName: data.printer || "XP-365B",
        marginsType: 0,
    };
    labelPrint.webContents.on("did-finish-load", async function () {
        await labelPrint.webContents.send("printDocument", data);
        setTimeout(function () {
            labelPrint.webContents.print(printOptions, (success, errorType) => {
                if (!success) {
                    console.log(errorType);
                }
                // labelPrint.close();
            });
        }, 200);
    });
});

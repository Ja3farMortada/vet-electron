const {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    Menu,
    shell,
} = require("electron");
const path = require("path");
const fs = require("fs");

const buildMenuTemplate = require("./menu");
const { createTabManager } = require("./tabs");

// ── single instance ─────────────────────────────────────────────────────────
// Only one copy of the app may run. A second process would share the same
// userData / localStorage and open its own duplicate socket connections.
//
// The lock is taken as the very first thing, before any window, storage or menu
// setup, so a second launch quits without ever touching them. Use a new TAB
// (Ctrl/Cmd+T) rather than a second instance.
const gotTheLock = app.requestSingleInstanceLock();

/** The one window (the tab strip). Focused when a second launch is attempted. */
let mainWindow = null;

if (!gotTheLock) {
    app.quit();
    // Nothing below this line runs in the second process.
    return;
}

// A second launch just brings the window we already have to the front.
app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
});

// electron context menu
// v3 is CommonJS and exports the function directly; v4+ is ESM-only, so under
// Electron's require(esm) the function arrives on `.default` and the module
// object itself is not callable. Accept either shape.
const contextMenuModule = require("electron-context-menu");
const contextMenu = contextMenuModule.default ?? contextMenuModule;

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
            webContents.loadFile(
                path.join(__dirname, "app/browser/index.html"),
            );
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

    // referenced by the second-instance handler
    mainWindow = win;
    win.on("closed", () => {
        if (mainWindow === win) mainWindow = null;
    });

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

/**
 * Prints the window's content, falling back to Save-as-PDF when printing
 * fails outright.
 *
 * Since the Electron 43 upgrade, webContents.print({silent:false}) no longer
 * opens the macOS print dialog when the machine has NO printers configured —
 * Chromium pre-checks the printer list and immediately invokes the callback
 * with success=false ("No printers available on the network"). The old code's
 * only response was printWindow.close(), so the window flashed open and closed
 * with no dialog and no explanation.
 *
 * failureReason === "cancelled" means the user closed the dialog themselves —
 * that is a normal outcome, not a failure.
 */
function printWithPdfFallback(win, printOptions, pdfName) {
    win.webContents.print(printOptions, async (success, failureReason) => {
        if (success || failureReason === "cancelled") {
            win.close();
            return;
        }

        console.error("print failed:", failureReason);
        try {
            const { canceled, filePath } = await dialog.showSaveDialog(win, {
                title: "Printing failed — save as PDF instead",
                defaultPath: pdfName,
                filters: [{ name: "PDF", extensions: ["pdf"] }],
            });
            if (!canceled && filePath) {
                const pdf = await win.webContents.printToPDF({});
                fs.writeFileSync(filePath, pdf);
                shell.showItemInFolder(filePath);
            }
        } catch (error) {
            console.error("PDF fallback failed:", error);
        }
        win.close();
    });
}

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
        printWithPdfFallback(
            printWindow,
            printOptions,
            `${(data && data.invoice_number) || "invoice"}.pdf`,
        );
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
        printWithPdfFallback(printWindow, printOptions, "stock.pdf");
    });
});

// label print
// Hardcoded label printer. Must be the system device name exactly as Windows
// lists it (`Get-Printer | Select-Object Name`) — not the friendly name.
const LABEL_PRINTER_NAME = "XP-365B";

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
        deviceName: LABEL_PRINTER_NAME,
        marginsType: 0,
    };
    labelPrint.webContents.on("did-finish-load", async function () {
        await labelPrint.webContents.send("printDocument", data);
        setTimeout(function () {
            labelPrint.webContents.print(printOptions, (success, errorType) => {
                if (success || errorType === "cancelled") return;

                console.log(errorType);

                // Electron 43 compatibility: Chromium now validates deviceName
                // against the installed printers BEFORE opening the dialog, so a
                // name that doesn't match EXACTLY kills the job outright with
                // "Invalid deviceName provided" and no dialog ever appears.
                // Older Electron ignored a bad name and just opened the dialog —
                // which is why this code worked before the upgrade.
                //
                // Retry once with no deviceName so the printer/driver popup
                // still comes up and the printer can be chosen there.
                if (errorType === "Invalid deviceName provided") {
                    labelPrint.webContents.print(
                        { silent: false, marginsType: 0 },
                        (retried, retryError) => {
                            if (!retried) console.log(retryError);
                        },
                    );
                }
                // labelPrint.close();
            });
        }, 200);
    });
});

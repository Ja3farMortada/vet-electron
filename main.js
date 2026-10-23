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
 * The failureReason Electron reports when the user closes the print dialog.
 * Same string on Electron 39 and 43 (listed in electron.d.ts under print()).
 * It is NOT "cancelled" — checking for that let every cancel fall through to
 * the Save-as-PDF fallback below.
 */
const PRINT_JOB_CANCELED = "Print job canceled";

/**
 * Prints the window's content, falling back to Save-as-PDF when printing
 * fails outright.
 *
 * print() can fail before any dialog opens — e.g. "No printers available on
 * the network" on a machine with no printer installed. Electron reports the
 * reason ONLY through this callback, and console output goes nowhere on a
 * packaged app, so the reason is shown to the user before the PDF offer. A
 * silent fallback is what hid the Electron 43.0–43.1.1 bug where every print
 * with options failed with "Invalid printer settings" (fixed in 43.2.0).
 *
 * A user cancel is a normal outcome, not a failure — see PRINT_JOB_CANCELED.
 */
function printWithPdfFallback(win, printOptions, pdfName) {
    win.webContents.print(printOptions, async (success, failureReason) => {
        // The print window was closed under us — nothing left to report on.
        if (win.isDestroyed()) return;

        if (success || failureReason === PRINT_JOB_CANCELED) {
            win.close();
            return;
        }

        console.error("print failed:", failureReason);
        try {
            const { response } = await dialog.showMessageBox(win, {
                type: "warning",
                title: "Printing failed",
                message: "The document could not be printed.",
                detail: `Reason: ${failureReason || "unknown"}\n\nYou can save it as a PDF instead.`,
                buttons: ["Save as PDF", "Close"],
                defaultId: 0,
                cancelId: 1,
                noLink: true,
            });
            if (response === 0) {
                const { canceled, filePath } = await dialog.showSaveDialog(win, {
                    title: "Save as PDF",
                    defaultPath: pdfName,
                    filters: [{ name: "PDF", extensions: ["pdf"] }],
                });
                if (!canceled && filePath) {
                    const pdf = await win.webContents.printToPDF({});
                    fs.writeFileSync(filePath, pdf);
                    shell.showItemInFolder(filePath);
                }
            }
        } catch (error) {
            console.error("PDF fallback failed:", error);
        }
        if (!win.isDestroyed()) win.close();
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

/**
 * Tell the operator a label didn't print, and why. Without this a failed label
 * did nothing visible at all — the reason only reached console.log.
 *
 * Parented to the main window, not the label window: that one is never shown,
 * and a dialog owned by a hidden window can end up invisible.
 */
function reportLabelFailure(failureReason) {
    console.error("label print failed:", failureReason);
    const options = {
        type: "warning",
        title: "Label printing failed",
        message: "The label could not be printed.",
        detail: `Printer: ${LABEL_PRINTER_NAME}\nReason: ${failureReason || "unknown"}`,
        buttons: ["OK"],
        noLink: true,
    };
    return mainWindow && !mainWindow.isDestroyed()
        ? dialog.showMessageBox(mainWindow, options)
        : dialog.showMessageBox(options);
}

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
                if (success || errorType === PRINT_JOB_CANCELED) return;

                // deviceName is checked against the installed printers before
                // any dialog opens (Electron 39 and 43 alike), so a name that
                // doesn't match EXACTLY fails with "Invalid deviceName
                // provided". Retry once without it so the Windows printer/driver
                // popup still comes up and the printer can be chosen there.
                if (errorType !== "Invalid deviceName provided") {
                    reportLabelFailure(errorType);
                    return;
                }
                labelPrint.webContents.print(
                    { silent: false, marginsType: 0 },
                    (retried, retryError) => {
                        if (retried || retryError === PRINT_JOB_CANCELED) return;
                        reportLabelFailure(retryError);
                    },
                );
                // labelPrint.close();
            });
        }, 200);
    });
});

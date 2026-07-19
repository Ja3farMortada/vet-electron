const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
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

// ── label printing ───────────────────────────────────────────────────────────
// Labels print SILENTLY to a dedicated device — the OS driver dialog never
// appears. Instead, on every label request we enumerate printers and show our
// own small picker (with the previously used label printer preselected), then
// print straight to the chosen device. The choice is persisted for label
// printing only.
//
// This replaces the old flow, which had three defects: it read `data.printer`
// while the app sends `printerName` (so the hardcoded "XP-365B" fallback always
// won), it combined silent:false with deviceName (deviceName only applies to
// silent printing — on Electron 43 this dies instantly when no printers exist),
// and it never closed the hidden window, leaking one per printed label.

const labelPrinterFile = () =>
    path.join(app.getPath("userData"), "label-printer.json");

function loadSavedLabelPrinter() {
    try {
        return JSON.parse(fs.readFileSync(labelPrinterFile(), "utf8")).name || null;
    } catch {
        return null;
    }
}

function saveLabelPrinter(name) {
    try {
        fs.writeFileSync(labelPrinterFile(), JSON.stringify({ name }));
    } catch (error) {
        console.error("could not persist label printer choice:", error);
    }
}

/**
 * Shows the printer picker and resolves with the chosen printer name, or null
 * when the user cancels (button, Esc, or closing the window).
 */
function pickLabelPrinter(printers, preselected) {
    return new Promise((resolve) => {
        const picker = new BrowserWindow({
            width: 380,
            height: 440,
            resizable: false,
            minimizable: false,
            maximizable: false,
            alwaysOnTop: true,
            show: false,
            webPreferences: {
                preload: path.join(__dirname, "preload.js"),
            },
        });

        let settled = false;
        const settle = (value) => {
            if (settled) return;
            settled = true;
            ipcMain.removeHandler("label-printer-picked");
            resolve(value);
            if (!picker.isDestroyed()) picker.close();
        };

        // The picker page talks through preload's send() → ipcRenderer.invoke,
        // so this must be a handle()r. Registered per pick; the labelPickerBusy
        // flag guarantees no double registration.
        ipcMain.handle("label-printer-picked", (pickEvent, name) => {
            if (pickEvent.sender === picker.webContents) settle(name ?? null);
        });
        picker.on("closed", () => settle(null));

        picker.loadFile("assets/printerPicker.html", {
            query: {
                printers: JSON.stringify(
                    printers.map((p) => ({
                        name: p.name,
                        displayName: p.displayName || p.name,
                        isDefault: !!p.isDefault,
                    })),
                ),
                selected: preselected || "",
            },
        });
        picker.once("ready-to-show", () => picker.show());
    });
}

let labelPrint;
let labelPickerBusy = false;
ipcMain.handle("label-print", async (event, data) => {
    // one picker at a time — a second request while choosing is dropped
    if (labelPickerBusy) return { success: false, reason: "picker-open" };
    labelPickerBusy = true;

    labelPrint = new BrowserWindow({
        width: 230,
        height: 180,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
        },
    });
    const win = labelPrint;

    try {
        // Render the label while the user picks the printer.
        const rendered = new Promise((resolve) => {
            win.webContents.on("did-finish-load", () => {
                win.webContents.send("printDocument", data);
                // barcode (jsbarcode) draws after the data lands — give it a beat
                setTimeout(resolve, 200);
            });
        });
        win.loadFile("assets/labelPrint.html");

        const printers = await win.webContents.getPrintersAsync();
        if (!printers.length) {
            dialog.showErrorBox(
                "No printers found",
                "No printers are configured on this computer, so the label cannot be printed.",
            );
            return { success: false, reason: "no-printers" };
        }

        const preselected =
            loadSavedLabelPrinter() || data.printerName || data.printer || "";
        const chosen = await pickLabelPrinter(printers, preselected);
        if (!chosen) return { success: false, reason: "cancelled" };
        saveLabelPrinter(chosen);

        await rendered;
        const success = await new Promise((resolve) => {
            win.webContents.print(
                { silent: true, deviceName: chosen, marginsType: 0 },
                (ok, errorType) => {
                    if (!ok) {
                        console.error("label print failed:", errorType);
                        dialog.showErrorBox(
                            "Label print failed",
                            `Printing to "${chosen}" failed: ${errorType || "unknown error"}`,
                        );
                    }
                    resolve(ok);
                },
            );
        });
        return { success };
    } finally {
        labelPickerBusy = false;
        if (!win.isDestroyed()) win.close();
    }
});

const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");

// Menu
const template = require("./menu");
const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);

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

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
        },
    });
    win.maximize();
    win.show();

    const loadSystem = function () {
        if (isDev) {
            win.loadURL("http://localhost:4200");
        } else {
            win.loadFile("app/browser/index.html");
        }
    };

    loadSystem();

    win.webContents.on("did-fail-load", () => {
        loadSystem();
    });

    // require update module
    const updater = require("./update");
    updater(win, ipcMain);
}

app.whenReady().then(() => {
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
    labelPrint.show();

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

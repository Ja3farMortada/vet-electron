// const { autoUpdater } = require("electron-updater");

const log = require("electron-log");

const { updateElectronApp } = require("update-electron-app");

module.exports = (dialog, ipcMain) => {
    // update method
    ipcMain.handle("update", () => {
        // sendStatusToWindow("checking-for-update", "Checking for update...");
        // updateElectronApp .checkForUpdates();

        updateElectronApp({
            updateInterval: "1 hour", // Check for updates every hour
            repo: "ja3farMortada/vet-electron",
            updateCheckInterval: 1, // Check for updates every 10 minutes
            logger: require("electron-log"),
        });
    });

    // // Listen for update events
    // updateElectronApp.on("update-available", () => {
    //     dialog.showMessageBox(mainWindow, {
    //         type: "info",
    //         title: "Update Available",
    //         message: "A new version is available. Downloading now...",
    //     });
    // });

    // updateElectronApp.on("update-not-available", () => {
    //     console.log("No updates available");
    // });

    // updateElectronApp.on("download-progress", (progress) => {
    //     const { percent } = progress;
    //     console.log(`Download progress: ${percent}%`);

    //     // Optionally, you can send this progress to the renderer process
    //     mainWindow.webContents.send("download-progress", percent);
    // });

    // updateElectronApp.on("update-downloaded", () => {
    //     dialog
    //         .showMessageBox(mainWindow, {
    //             type: "info",
    //             title: "Update Ready",
    //             message: "Update downloaded. It will be installed on quit.",
    //         })
    //         .then(() => {
    //             updateElectronApp.quitAndInstall();
    //         });
    // });

    // updateElectronApp.on("error", (error) => {
    //     console.error("Update error:", error);
    //     dialog.showMessageBox(mainWindow, {
    //         type: "error",
    //         title: "Update Error",
    //         message: `An error occurred while checking for updates: ${error.message}`,
    //     });
    // });

    // auto update module
    // autoUpdater.autoDownload = false;
    // autoUpdater.disableDifferentialDownload = false;
    // autoUpdater.disable;
    // autoUpdater.logger = log;
    // autoUpdater.logger.transports.file.level = "info";
    // // // define main to renderer message
    // async function sendStatusToWindow(message, data) {
    //     if (win) {
    //         await win.webContents.send(message, data);
    //         // win.ipcMain.send(message, data);
    //     }
    // }
    // // // update method
    // ipcMain.handle("update", () => {
    //     sendStatusToWindow("checking-for-update", "Checking for update...");
    //     autoUpdater.checkForUpdates();
    // });
    // // download update method
    // ipcMain.handle("download", () => {
    //     autoUpdater.downloadUpdate();
    // });
    // // apply downloaded update
    // ipcMain.handle("applyUpdate", () => {
    //     autoUpdater.quitAndInstall();
    // });
    // // checking for update
    // autoUpdater.on("checking-for-update", () => {
    //     sendStatusToWindow("checking-for-update", "Checking for update...");
    // });
    // // update available
    // autoUpdater.on("update-available", (info) => {
    //     sendStatusToWindow("update-available", info);
    // });
    // // update not available
    // autoUpdater.on("update-not-available", (info) => {
    //     sendStatusToWindow("up-to-date", info);
    // });
    // // error
    // autoUpdater.on("error", (err) => {
    //     sendStatusToWindow("error", err);
    // });
    // autoUpdater.on("download-progress", (progressObj) => {
    //     let log_message = "Download speed: " + progressObj.bytesPerSecond;
    //     log_message =
    //         log_message + " - Downloaded " + progressObj.percent + "%";
    //     log_message =
    //         log_message +
    //         " (" +
    //         progressObj.transferred +
    //         "/" +
    //         progressObj.total +
    //         ")";
    //     sendStatusToWindow("downloading", progressObj);
    // });
    // autoUpdater.on("update-downloaded", (info) => {
    //     sendStatusToWindow("update-downloaded", info);
    // });
};

const { autoUpdater } = require("electron-updater");
const { dialog } = require("electron");

const log = require("electron-log");

/**
 * @param getTargets () => webContents[] — every open tab. The window itself now
 *        renders only the tab strip, so update events must be broadcast to the
 *        tabs (where the Angular app lives), not to window.webContents.
 */
module.exports = (getTargets, ipcMain) => {
    // auto update module

    autoUpdater.autoDownload = false;
    autoUpdater.disableDifferentialDownload = false;
    autoUpdater.disable;
    autoUpdater.logger = log;
    autoUpdater.logger.transports.file.level = "info";

    // define main to renderer message
    function sendStatusToWindow(message, data) {
        for (const webContents of getTargets() || []) {
            if (webContents && !webContents.isDestroyed()) {
                webContents.send(message, data);
            }
        }
    }

    // update method
    ipcMain.handle("update", () => {
        sendStatusToWindow("checking-for-update", "Checking for update...");
        autoUpdater.checkForUpdates();
    });

    // download update method
    ipcMain.handle("download", () => {
        autoUpdater.downloadUpdate();
    });

    // apply downloaded update
    ipcMain.handle("applyUpdate", () => {
        autoUpdater.quitAndInstall();
    });

    // checking for update
    autoUpdater.on("checking-for-update", () => {
        sendStatusToWindow("checking-for-update", "Checking for update...");
    });

    // update available
    autoUpdater.on("update-available", (info) => {
        sendStatusToWindow("update-available", info);
    });

    // update not available
    autoUpdater.on("update-not-available", (info) => {
        sendStatusToWindow("up-to-date", info);
    });

    // error
    autoUpdater.on("error", (err) => {
        sendStatusToWindow("error", err);
    });

    autoUpdater.on("download-progress", (progressObj) => {
        let log_message = "Download speed: " + progressObj.bytesPerSecond;
        log_message =
            log_message + " - Downloaded " + progressObj.percent + "%";
        log_message =
            log_message +
            " (" +
            progressObj.transferred +
            "/" +
            progressObj.total +
            ")";
        sendStatusToWindow("downloading", progressObj);
    });

    autoUpdater.on("update-downloaded", (info) => {
        sendStatusToWindow("update-downloaded", info);
    });
};

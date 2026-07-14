const { contextBridge, ipcRenderer } = require("electron");

// ── inherit the opening tab's session ────────────────────────────────────────
// The auth token lives in sessionStorage, which is per-tab and shared by nothing.
// A tab opened from another tab is handed that tab's sessionStorage here, and we
// apply it BEFORE any app script runs (preload executes ahead of page scripts) —
// the app reads the token during bootstrap, so applying it later would be too
// late and the tab would already have routed to /login.
//
// Only ever fills in keys the tab doesn't already have, so a reload never
// clobbers a session the tab established itself.
try {
    const seed = ipcRenderer.sendSync("tabs:session-seed");
    if (seed) {
        const entries = JSON.parse(seed);
        for (const key of Object.keys(entries)) {
            if (window.sessionStorage.getItem(key) === null) {
                window.sessionStorage.setItem(key, entries[key]);
            }
        }
    }
} catch {
    // No seed (first tab, or a print window) — boot normally.
}

contextBridge.exposeInMainWorld("electron", {
    ipcRenderer: ipcRenderer,
    send: async (channel, data) => {
        let response = await ipcRenderer.invoke(channel, data);
        return response;
    },
    receive: (channel, fn) => {
        ipcRenderer.on(channel, fn);
    },
    print: (callback) => ipcRenderer.on("printDocument", callback),

    checkingForUpdate: (callback) =>
        ipcRenderer.on("checking-for-update", callback),

    updateAvailable: (callback) => ipcRenderer.on("update-available", callback),

    updateNotAvailable: (callback) => ipcRenderer.on("up-to-date", callback),

    error: (callback) => ipcRenderer.on("error", callback),

    downloading: (callback) => ipcRenderer.on("downloading", callback),

    downloadCompleted: (callback) =>
        ipcRenderer.on("update-downloaded", callback),
});

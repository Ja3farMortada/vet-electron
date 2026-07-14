const { contextBridge, ipcRenderer } = require("electron");

// Preload for the tab strip only (assets/tabs.html). Deliberately separate from
// preload.js: the strip is chrome, not the app, and needs none of the app's IPC.
contextBridge.exposeInMainWorld("tabsApi", {
    onState: (callback) =>
        ipcRenderer.on("tabs:state", (_event, tabs) => callback(tabs)),
    newTab: () => ipcRenderer.send("tabs:new"),
    select: (id) => ipcRenderer.send("tabs:select", id),
    close: (id) => ipcRenderer.send("tabs:close", id),
});

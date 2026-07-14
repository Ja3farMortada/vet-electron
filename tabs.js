const { WebContentsView, ipcMain } = require("electron");

// Height of the tab strip rendered by the window itself (assets/tabs.html).
// Content views are laid out underneath it.
const TAB_BAR_HEIGHT = 40;

/**
 * sessionStorage handed to a tab that is about to boot: webContents.id -> JSON.
 *
 * The auth token lives in sessionStorage (TokenStorageService), which is
 * per-renderer and shared by nothing — not even by real browser tabs. Without
 * this, every new tab boots logged out and bounces to /login.
 *
 * The app reads the token during bootstrap, so the seed has to be in place
 * BEFORE any app script runs. preload.js therefore asks for it synchronously
 * (preload runs ahead of page scripts). Registered at module scope, so it is
 * registered exactly once.
 */
const pendingSeeds = new Map();

ipcMain.on("tabs:session-seed", (event) => {
    const seed = pendingSeeds.get(event.sender.id) ?? null;
    pendingSeeds.delete(event.sender.id);
    event.returnValue = seed;
});

// Reads a tab's sessionStorage as JSON. Built explicitly rather than
// JSON.stringify(sessionStorage) — Storage is not a plain object.
const READ_SESSION_STORAGE = `
    JSON.stringify(
        Object.keys(window.sessionStorage).reduce((acc, key) => {
            acc[key] = window.sessionStorage.getItem(key);
            return acc;
        }, {})
    )
`;

/**
 * Chrome-style tabs for the app.
 *
 * The BrowserWindow renders only the tab strip; each tab is a WebContentsView
 * holding its own instance of the Angular app. All views share the window's
 * default session, so they share cookies and localStorage exactly the way real
 * browser tabs do — a new tab is already logged in and sees the same saved data.
 *
 * Only the active tab is attached to the window (that is what makes it visible).
 * Detached tabs are NOT destroyed: they keep running in the background with
 * their own state, again like a real browser tab.
 */
function createTabManager(win, { loadTab, preload }) {
    /** @type {{id:number, view:WebContentsView, attached:boolean}[]} */
    const tabs = [];
    let nextId = 1;
    let activeId = null;

    function contentBounds() {
        const [width, height] = win.getContentSize();
        return {
            x: 0,
            y: TAB_BAR_HEIGHT,
            width,
            height: Math.max(0, height - TAB_BAR_HEIGHT),
        };
    }

    function layout() {
        const bounds = contentBounds();
        for (const tab of tabs) {
            if (tab.attached) tab.view.setBounds(bounds);
        }
    }

    function getActive() {
        return tabs.find((tab) => tab.id === activeId) || null;
    }

    /** webContents of every tab — used to broadcast (e.g. auto-update events). */
    function getAllWebContents() {
        return tabs
            .filter((tab) => !tab.view.webContents.isDestroyed())
            .map((tab) => tab.view.webContents);
    }

    function getActiveWebContents() {
        const active = getActive();
        return active && !active.view.webContents.isDestroyed()
            ? active.view.webContents
            : null;
    }

    function sendState() {
        if (win.isDestroyed()) return;
        win.webContents.send(
            "tabs:state",
            tabs.map((tab) => ({
                id: tab.id,
                title: tab.view.webContents.isDestroyed()
                    ? "Veterinary"
                    : tab.view.webContents.getTitle() || "Veterinary",
                active: tab.id === activeId,
            })),
        );
    }

    function detach(tab) {
        if (!tab.attached) return;
        win.contentView.removeChildView(tab.view);
        tab.attached = false;
    }

    function attach(tab) {
        if (tab.attached) return;
        win.contentView.addChildView(tab.view);
        tab.attached = true;
        tab.view.setBounds(contentBounds());
    }

    function setActive(id) {
        const next = tabs.find((tab) => tab.id === id);
        if (!next) return;

        for (const tab of tabs) {
            if (tab.id !== id) detach(tab);
        }
        attach(next);

        activeId = id;
        if (!next.view.webContents.isDestroyed()) {
            next.view.webContents.focus();
        }
        sendState();
    }

    /**
     * Opens a new tab. It loads the app fresh, so it lands on the home page —
     * and it inherits the opening tab's sessionStorage (where the auth token
     * lives), so it boots already logged in rather than bouncing to /login.
     */
    async function newTab() {
        // Snapshot the CURRENT tab before the new one exists, so its preload can
        // pick the seed up synchronously as it boots.
        let seed = null;
        const source = getActiveWebContents();
        if (source) {
            try {
                seed = await source.executeJavaScript(READ_SESSION_STORAGE);
            } catch {
                seed = null;
            }
        }

        const view = new WebContentsView({ webPreferences: { preload } });
        const tab = { id: nextId++, view, attached: false };
        tabs.push(tab);

        const wc = view.webContents;
        if (seed) pendingSeeds.set(wc.id, seed);

        wc.on("page-title-updated", () => sendState());
        wc.on("destroyed", () => pendingSeeds.delete(wc.id));

        loadTab(wc);
        setActive(tab.id);
        return tab;
    }

    function closeTab(id) {
        const index = tabs.findIndex((tab) => tab.id === id);
        if (index === -1) return;

        const [tab] = tabs.splice(index, 1);
        detach(tab);
        if (!tab.view.webContents.isDestroyed()) {
            tab.view.webContents.close();
        }

        // Closing the last tab closes the window, like a browser.
        if (!tabs.length) {
            if (!win.isDestroyed()) win.close();
            return;
        }

        if (activeId === id) {
            setActive(tabs[Math.min(index, tabs.length - 1)].id);
        } else {
            sendState();
        }
    }

    function closeActiveTab() {
        if (activeId !== null) closeTab(activeId);
    }

    /** Ctrl+Tab style cycling. */
    function cycleTab(step) {
        if (tabs.length < 2) return;
        const index = tabs.findIndex((tab) => tab.id === activeId);
        const next = (index + step + tabs.length) % tabs.length;
        setActive(tabs[next].id);
    }

    win.on("resize", layout);

    return {
        TAB_BAR_HEIGHT,
        newTab,
        closeTab,
        closeActiveTab,
        setActive,
        cycleTab,
        layout,
        sendState,
        getActiveWebContents,
        getAllWebContents,
    };
}

module.exports = { createTabManager, TAB_BAR_HEIGHT };

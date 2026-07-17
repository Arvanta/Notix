// Notix - Background Script

// Context Menus
browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
        id: "add-to-notes",
        title: "Add selected text to Notix",
        contexts: ["selection"],
    });

    browser.contextMenus.create({
        id: "copy-to-notes",
        title: "Copy selected text to a new note",
        contexts: ["selection"],
    });

    browser.contextMenus.create({
        id: "open-sidebar",
        title: "Open Notix Sidebar",
        contexts: ["page", "selection"],
    });
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (
        info.menuItemId === "add-to-notes" ||
        info.menuItemId === "copy-to-notes"
    ) {
        const selectedText = info.selectionText;
        if (!selectedText) return;

        if (info.menuItemId === "copy-to-notes") {
            await createNewNoteWithText(selectedText, "Quick Capture");
        } else {
            await addTextToCurrentNote(selectedText);
        }
    } else if (info.menuItemId === "open-sidebar") {
        browser.sidebarAction.open();
    }
});

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

async function createNewNoteWithText(text, titlePrefix = "Note") {
    const notes = await getAllNotes();
    const newNote = {
        id: generateId(),
        title: `${titlePrefix} - ${new Date().toLocaleDateString()}`,
        content: `<p>${escapeHtml(text)}</p>`,
        created: Date.now(),
        updated: Date.now(),
        direction: "ltr",
    };
    notes.unshift(newNote);
    await browser.storage.local.set({ notes });

    browser.sidebarAction.open();
}

async function addTextToCurrentNote(text) {
    const { notes = [] } = await browser.storage.local.get("notes");
    const { lastOpenedNoteId } = await browser.storage.local.get(
        "lastOpenedNoteId"
    );

    let targetNote;

    if (lastOpenedNoteId) {
        targetNote = notes.find((n) => n.id === lastOpenedNoteId);
    }

    if (!targetNote && notes.length > 0) {
        targetNote = notes[0];
    }

    if (!targetNote) {
        await createNewNoteWithText(text);
        return;
    }

    const appendHtml = `<br><p>${escapeHtml(text)}</p>`;
    targetNote.content = (targetNote.content || "") + appendHtml;
    targetNote.updated = Date.now();

    await browser.storage.local.set({ notes });

    browser.sidebarAction.open();
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

async function getAllNotes() {
    const { notes = [] } = await browser.storage.local.get("notes");
    return notes;
}

browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.action === "getNotes") {
        const notes = await getAllNotes();
        return { notes };
    }
    if (message.action === "saveNotes") {
        await browser.storage.local.set({ notes: message.notes });
        return { success: true };
    }
    if (message.action === "setLastOpened") {
        await browser.storage.local.set({ lastOpenedNoteId: message.id });
        return { success: true };
    }
});

// Toolbar action - open sidebar
browser.action.onClicked.addListener(() => {
    browser.sidebarAction.open();
});

// ==========================================
// Unified Dynamic Icon Switching
// ==========================================

function updateIcons(isDark) {
  const folderName = isDark ? 'dark' : 'light';
  
  // Update Toolbar Icon
  browser.action.setIcon({
    path: {
      "16": `icons/${folderName}/icon16.png`,
      "32": `icons/${folderName}/icon32.png`,
      "48": `icons/${folderName}/icon48.png`
    }
  });

  // Update Sidebar Icon
  browser.sidebarAction.setIcon({
    path: `icons/${folderName}/icon32.png`
  });
}

// Check initial theme on startup
updateIcons(window.matchMedia('(prefers-color-scheme: dark)').matches);

// Listen for live theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  updateIcons(e.matches);
});


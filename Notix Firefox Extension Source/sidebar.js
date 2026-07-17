// State & Constants
const NOTES_KEY = "notes";
const LAST_NOTE_KEY = "lastOpenedNoteId";
const THEME_KEY = "theme";

let notes = [];
let currentNote = null;
let currentTheme = "auto";
let savedSelection = null;

let notesListEl, editorPanelEl, emptyStateEl, editorEl, noteTitleEl, searchInputEl;
let notesListContainer, toggleNotesBtn, fontSelect, fontSizeSelect;

document.addEventListener("DOMContentLoaded", async () => {
  initDOM();
  await loadNotes();
  await loadTheme();
  setupEventListeners();
  setupKeyboardShortcuts();
  setupAutoTheme();

  // Background Sync (Safe listener for context-menu additions)
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.notes) {
      loadNotes();
      if (currentNote && changes.notes.newValue) {
        const updatedNote = changes.notes.newValue.find((n) => n.id === currentNote.id);
        if (updatedNote && updatedNote.updated !== currentNote.updated) {
          // Prevent editor reset if user is currently typing
          if (document.activeElement !== editorEl) {
            editorEl.innerHTML = updatedNote.content;
            updateWordCount();
          }
        }
      }
    }
  });

  const { lastOpenedNoteId } = await browser.storage.local.get(LAST_NOTE_KEY);
  if (lastOpenedNoteId) {
    const note = notes.find((n) => n.id === lastOpenedNoteId);
    if (note) openNote(note);
  }
});

function initDOM() {
  notesListEl = document.getElementById("notes-list");
  editorPanelEl = document.getElementById("editor-panel");
  emptyStateEl = document.getElementById("empty-state");
  editorEl = document.getElementById("editor");
  noteTitleEl = document.getElementById("note-title");
  searchInputEl = document.getElementById("search-input");
  notesListContainer = document.getElementById("notes-list-container");
  toggleNotesBtn = document.getElementById("toggle-notes-btn");
  fontSelect = document.getElementById("font-select");
  fontSizeSelect = document.getElementById("font-size-select");
}

// Save/Restore text selection for toolbar buttons
function saveSelection() {
  const sel = window.getSelection();
  if (sel.rangeCount > 0) savedSelection = sel.getRangeAt(0).cloneRange();
}

function restoreSelection() {
  if (savedSelection) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedSelection);
  }
}

function setupEventListeners() {
  const safeAdd = (id, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", handler);
  };

  // Prevent losing text selection when clicking toolbar
  const toolbar = document.querySelector(".toolbar");
  if (toolbar) {
    toolbar.addEventListener("mousedown", (e) => {
      if (e.target.closest(".toolbar-btn")) e.preventDefault();
    });
  }

  safeAdd("new-note-btn", createNewNote);
  safeAdd("empty-new-btn", createNewNote);
  safeAdd("btn-delete", deleteCurrentNote);
  safeAdd("btn-close-note", closeCurrentNote);

  safeAdd("btn-bold", () => applyFormat("bold"));
  safeAdd("btn-italic", () => applyFormat("italic"));
  safeAdd("btn-underline", () => applyFormat("underline"));
  safeAdd("btn-bullet", () => applyFormat("insertUnorderedList"));
  safeAdd("btn-number", () => applyFormat("insertOrderedList"));
  safeAdd("btn-align-left", () => applyFormat("justifyLeft"));
  safeAdd("btn-align-center", () => applyFormat("justifyCenter"));
  safeAdd("btn-align-right", () => applyFormat("justifyRight"));
  safeAdd("btn-rtl", () => applyDirectionToLine("rtl"));
  safeAdd("btn-ltr", () => applyDirectionToLine("ltr"));
  safeAdd("btn-link", showLinkModal);
  safeAdd("btn-undo", undo);
  safeAdd("btn-redo", redo);

  if (fontSelect) fontSelect.addEventListener("change", applyFont);
  if (fontSizeSelect) fontSizeSelect.addEventListener("change", applyFontSize);

  // Native Color Pickers
  const colorBtn = document.getElementById("btn-color");
  const bgColorBtn = document.getElementById("btn-bg-color");
  const nativeColorPicker = document.getElementById("native-color-picker");
  const nativeBgColorPicker = document.getElementById("native-bg-color-picker");

  // Recursively apply color to text nodes without breaking HTML structure
  function applyColorToSelection(color, cssProperty) {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;

    const range = sel.getRangeAt(0);
    const fragment = range.extractContents();

    function colorizeNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent.trim() !== "") {
          const span = document.createElement("span");
          span.style.cssText = `${cssProperty}: ${color};`;
          span.appendChild(node.cloneNode(true));
          return span;
        }
        return node.cloneNode(true);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const clonedNode = node.cloneNode(false);
        for (const child of node.childNodes) clonedNode.appendChild(colorizeNode(child));
        return clonedNode;
      }
      return node.cloneNode(true);
    }

    const coloredFragment = document.createDocumentFragment();
    for (const child of fragment.childNodes) coloredFragment.appendChild(colorizeNode(child));

    range.insertNode(coloredFragment);

    // Force cursor outside the colored span to prevent inheriting color
    const lastNode = coloredFragment.lastChild;
    if (lastNode) {
      const newRange = document.createRange();
      newRange.setStartAfter(lastNode);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    } else {
      sel.collapseToEnd();
    }
  }

  if (colorBtn && nativeColorPicker) {
    colorBtn.addEventListener("click", () => {
      const sel = window.getSelection();
      if (!sel || sel.toString().trim().length === 0) {
        showToast("Please select text first");
        return;
      }
      saveSelection();
      nativeColorPicker.value = "#000000";
      nativeColorPicker.click();
    });

    nativeColorPicker.addEventListener("change", (e) => {
      restoreSelection();
      editorEl.focus();
      applyColorToSelection(e.target.value, "color");
      saveCurrentNote();
    });
  }

  if (bgColorBtn && nativeBgColorPicker) {
    bgColorBtn.addEventListener("click", () => {
      const sel = window.getSelection();
      if (!sel || sel.toString().trim().length === 0) {
        showToast("Please select text first");
        return;
      }
      saveSelection();
      nativeBgColorPicker.value = "#ffffff";
      nativeBgColorPicker.click();
    });

    nativeBgColorPicker.addEventListener("change", (e) => {
      restoreSelection();
      editorEl.focus();
      applyColorToSelection(e.target.value, "background-color");
      saveCurrentNote();
    });
  }

  // Title & Editor Events
  if (noteTitleEl) {
    noteTitleEl.addEventListener("input", debounce(saveCurrentNote, 500));
    noteTitleEl.addEventListener("blur", () => renderNotesList());
  }

  if (editorEl) {
    editorEl.addEventListener("input", debounce(saveCurrentNote, 600));
    editorEl.addEventListener("blur", () => renderNotesList());
    editorEl.addEventListener("mouseup", updateFontSizeFromSelection);
    editorEl.addEventListener("keyup", updateFontSizeFromSelection);
  }

  if (searchInputEl) searchInputEl.addEventListener("input", filterNotes);

  safeAdd("settings-btn", openSettings);
  safeAdd("close-settings", closeSettings);
  safeAdd("btn-export-all", exportAllNotes);
  safeAdd("btn-import", () => {
    const input = document.getElementById("import-file");
    if (input) input.click();
  });

  const importFile = document.getElementById("import-file");
  if (importFile) importFile.addEventListener("change", importNotes);

  safeAdd("theme-light", () => setTheme("light"));
  safeAdd("theme-dark", () => setTheme("dark"));
  safeAdd("theme-auto", () => setTheme("auto"));
  safeAdd("toggle-notes-btn", toggleNotesList);

  if (editorEl) editorEl.addEventListener("click", handleLinkClick);
}

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (!currentNote) return;
    if ((e.ctrlKey || e.metaKey) && e.key === "b") { e.preventDefault(); applyFormat("bold"); }
    if ((e.ctrlKey || e.metaKey) && e.key === "i") { e.preventDefault(); applyFormat("italic"); }
    if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); showLinkModal(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "n") { e.preventDefault(); createNewNote(); }
  });
}

// Native Undo/Redo
function undo() {
  if (!currentNote) return;
  editorEl.focus();
  document.execCommand("undo", false, null);
}

function redo() {
  if (!currentNote) return;
  editorEl.focus();
  document.execCommand("redo", false, null);
}

// Theme Management
async function loadTheme() {
  const result = await browser.storage.local.get(THEME_KEY);
  currentTheme = result.theme || "auto";
  applyTheme(currentTheme);
}

function applyTheme(theme) {
  document.body.classList.remove("dark-theme");
  if (theme === "dark") {
    document.body.classList.add("dark-theme");
  } else if (theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    document.body.classList.add("dark-theme");
  }
  document.querySelectorAll(".theme-btn").forEach((b) => b.classList.remove("active"));
  const active = document.getElementById(`theme-${theme}`);
  if (active) active.classList.add("active");
}

function setTheme(theme) {
  currentTheme = theme;
  browser.storage.local.set({ [THEME_KEY]: theme });
  applyTheme(theme);
}

function setupAutoTheme() {
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (currentTheme === "auto") applyTheme("auto");
    });
  }
}

// Notes Management
async function loadNotes() {
  const result = await browser.storage.local.get(NOTES_KEY);
  const newNotes = result.notes || [];
  
  // Keep currentNote linked to the new array to prevent text deletion
  if (currentNote) {
    const idx = newNotes.findIndex((n) => n.id === currentNote.id);
    if (idx !== -1) newNotes[idx] = currentNote;
  }
  
  notes = newNotes;
  renderNotesList();
  if (notes.length === 0) showEmptyState();
}

function renderNotesList(filtered = null) {
  // Prevent error if called by blur event passing an Event object
  const isArr = Array.isArray(filtered);
  let list = isArr ? [...filtered] : [...notes];

  list.sort((a, b) => {
    const aPinned = a.isPinned || false;
    const bPinned = b.isPinned || false;
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    return (b.updated || b.created) - (a.updated || a.created);
  });

  notesListEl.innerHTML = "";
  if (list.length === 0) {
    notesListEl.innerHTML = `<div style="padding:16px;text-align:center;color:#94a3b8;font-size:12px;">No notes</div>`;
    return;
  }

  list.forEach((note) => {
    const div = document.createElement("div");
    div.className = `note-item ${currentNote && currentNote.id === note.id ? "active" : ""}`;
    const date = new Date(note.updated || note.created).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const preview = note.content ? escapeHtml(note.content.replace(/<[^>]+>/g, "").substring(0, 55)) : "No content";

    div.innerHTML = `
      <div style="flex:1;min-width:0;">
        <div style="display:flex; align-items:center; gap:6px;">
          <div class="note-title" style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(note.title || "Untitled")}</div>
          <button class="note-pin-btn ${note.isPinned ? "active" : ""}" title="${note.isPinned ? "Unpin note" : "Pin note"}">
            <i class="fa-solid fa-thumbtack"></i>
          </button>
          <button class="note-delete-btn" title="Delete note">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
        <div class="note-preview">${preview}</div>
      </div>
      <div class="note-date">${date}</div>
    `;

    div.onclick = (e) => {
      if (e.target.closest(".note-pin-btn") || e.target.closest(".note-delete-btn")) return;
      document.querySelectorAll(".note-item.active").forEach((el) => el.classList.remove("active"));
      div.classList.add("active");
      openNote(note);
    };

    const pinBtn = div.querySelector(".note-pin-btn");
    if (pinBtn) {
      pinBtn.onclick = (e) => {
        e.stopPropagation();
        togglePinNote(note.id);
      };
    }

    const deleteBtn = div.querySelector(".note-delete-btn");
    if (deleteBtn) {
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        if (confirm("Delete this note?")) {
          deleteNoteById(note.id);
        }
      };
    }

    notesListEl.appendChild(div);
  });
}

function filterNotes() {
  const term = searchInputEl.value.toLowerCase().trim();
  if (!term) return renderNotesList();
  const filtered = notes.filter((n) => (n.title && n.title.toLowerCase().includes(term)) || (n.content && n.content.toLowerCase().includes(term)));
  renderNotesList(filtered);
}

function toggleNotesList() {
  const icon = toggleNotesBtn.querySelector("i");
  if (notesListContainer.style.display === "none") {
    notesListContainer.style.display = "block";
    icon.classList.add("fa-chevron-up");
    icon.classList.remove("fa-chevron-down");
  } else {
    notesListContainer.style.display = "none";
    icon.classList.remove("fa-chevron-up");
    icon.classList.add("fa-chevron-down");
  }
}

function generateNextNoteTitle() {
  let i = 1;
  while (notes.some((n) => n.title === `Note ${i}`)) i++;
  return `Note ${i}`;
}

async function createNewNote() {
  const newNote = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    title: generateNextNoteTitle(),
    content: "<p></p>",
    created: Date.now(),
    updated: Date.now(),
    direction: "ltr",
    isPinned: false,
  };
  notes.unshift(newNote);
  await saveNotesToStorage();
  renderNotesList();
  openNote(newNote);
  setTimeout(() => { noteTitleEl.focus(); noteTitleEl.select(); }, 150);
}

function openNote(note) {
  currentNote = note;
  emptyStateEl.style.display = "none";
  editorPanelEl.style.display = "flex";
  noteTitleEl.value = note.title || "";
  editorEl.innerHTML = note.content || "<p></p>";
  browser.storage.local.set({ [LAST_NOTE_KEY]: note.id });
  updateWordCount();
  setTimeout(() => editorEl.focus(), 80);
}

function closeCurrentNote() {
  currentNote = null;
  editorPanelEl.style.display = "none";
  emptyStateEl.style.display = notes.length === 0 ? "flex" : "none";
  browser.storage.local.remove(LAST_NOTE_KEY);
  renderNotesList();
}

function showEmptyState() {
  editorPanelEl.style.display = "none";
  emptyStateEl.style.display = "flex";
  currentNote = null;
}

// Save & Formatting
async function saveNotesToStorage() {
  await browser.storage.local.set({ [NOTES_KEY]: notes });
}

async function saveCurrentNote() {
  if (!currentNote) return;
  currentNote.title = noteTitleEl.value.trim() || "Untitled";
  currentNote.content = editorEl.innerHTML;
  currentNote.updated = Date.now();
  await saveNotesToStorage();
  updateWordCount();
}

function applyFormat(cmd) {
  if (!currentNote) return;
  editorEl.focus();
  document.execCommand(cmd, false, null);
  setTimeout(saveCurrentNote, 60);
}

function applyFont() {
  if (!currentNote || !fontSelect) return;
  editorEl.focus();
  document.execCommand("fontName", false, fontSelect.value);
  setTimeout(saveCurrentNote, 60);
}

function applyFontSize() {
  if (!currentNote || !fontSizeSelect) return;
  const size = fontSizeSelect.value + "px";
  editorEl.focus();
  document.execCommand("fontSize", false, "3");
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const span = document.createElement("span");
    span.style.fontSize = size;
    try { range.surroundContents(span); } catch (e) {}
  }
  setTimeout(saveCurrentNote, 60);
}

function updateFontSizeFromSelection() {
  if (!fontSizeSelect || !currentNote) return;
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  let element = selection.getRangeAt(0).startContainer;
  if (element.nodeType === 3) element = element.parentNode;
  const sizeNum = parseInt(window.getComputedStyle(element).fontSize);
  if (sizeNum) fontSizeSelect.value = sizeNum;
}

function applyDirectionToLine(direction) {
  if (!currentNote) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let container = sel.getRangeAt(0).startContainer;
  while (container && container.nodeType !== 1) container = container.parentNode;
  if (!container) return;

  if (sel.toString().trim() === "") {
    container.style.direction = direction;
    container.style.unicodeBidi = "embed";
    container.style.textAlign = direction === "rtl" ? "right" : "left";
  } else {
    const span = document.createElement("span");
    span.style.direction = direction;
    span.style.unicodeBidi = "embed";
    try { sel.getRangeAt(0).surroundContents(span); } catch (e) {}
  }
  saveCurrentNote();
}

function showLinkModal() {
  if (!currentNote) return;
  const sel = window.getSelection();
  const hasSelection = sel && sel.rangeCount > 0 && sel.toString().trim() !== "";
  const savedRange = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;

  const isDark = document.body.classList.contains("dark-theme");
  const modalBg = isDark ? "#1e293b" : "white";
  const modalTextColor = isDark ? "#e2e8f0" : "#0f172a";
  const modalBorderColor = isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0";
  const inputBg = isDark ? "rgba(51,65,85,0.5)" : "#f8fafc";
  const inputColor = isDark ? "#e2e8f0" : "#0f172a";
  const btnBg = isDark ? "rgba(51,65,85,0.5)" : "#f1f5f9";
  const btnColor = isDark ? "#94a3b8" : "#64748b";
  const inputStyle = `width:100%;padding:8px 12px;border:1px solid ${modalBorderColor};border-radius:8px;font-size:13px;outline:none;font-family:inherit;background:${inputBg};color:${inputColor};box-sizing:border-box;`;

  const modal = document.createElement("div");
  modal.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:3000;";
  const textField = hasSelection ? "" : `<input id="link-text" placeholder="Link text (optional)" class="link-input" style="${inputStyle} margin-bottom:8px;">`;

  modal.innerHTML = `
    <div style="background:${modalBg};width:300px;border-radius:16px;box-shadow:0 25px 50px -12px rgb(0 0 0 / 0.25);overflow:hidden;">
      <div style="padding:14px 18px;border-bottom:1px solid ${modalBorderColor};display:flex;justify-content:space-between;align-items:center;">
        <strong style="color:${modalTextColor}">Insert Link</strong>
        <span style="cursor:pointer;font-size:22px;color:${btnColor};" class="close-modal">×</span>
      </div>
      <div style="padding:18px;">
        ${textField}
        <input id="link-url" placeholder="https://example.com" class="link-input" value="https://" style="${inputStyle}">
        <div style="display:flex;gap:8px;margin-top:14px;">
          <button id="cancel-link" style="flex:1;padding:9px;border-radius:10px;border:1px solid ${modalBorderColor};background:${btnBg};cursor:pointer;font-family:inherit;color:${btnColor};">Cancel</button>
          <button id="insert-link" style="flex:1;padding:9px;border-radius:10px;border:none;background:#0d9488;color:white;cursor:pointer;font-family:inherit;font-weight:600;">Insert Link</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  const urlInput = modal.querySelector("#link-url");
  const textInput = modal.querySelector("#link-text");
  const closeModal = () => modal.remove();

  urlInput.focus();
  urlInput.select();

  const insertLink = () => {
    const url = urlInput.value.trim();
    if (!url) return closeModal();
    let linkText = textInput ? textInput.value.trim() : url;

    editorEl.focus();
    if (savedRange) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }

    if (hasSelection) {
      document.execCommand("createLink", false, url);
    } else {
      document.execCommand("insertHTML", false, `<a href="${url}" target="_blank" rel="noopener noreferrer">${linkText}</a>`);
    }

    setTimeout(() => {
      editorEl.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
      saveCurrentNote();
    }, 30);
    closeModal();
  };

  modal.querySelector("#insert-link").addEventListener("click", insertLink);
  modal.querySelector("#cancel-link").addEventListener("click", closeModal);
  modal.querySelector(".close-modal").addEventListener("click", closeModal);
  urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") insertLink(); });
}

function handleLinkClick(e) {
  if (e.target.tagName === "A") {
    e.preventDefault();
    browser.tabs.create({ url: e.target.href });
  }
}

function updateWordCount() {
  if (!currentNote || !editorEl) return;
  const text = editorEl.innerText || "";
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  document.getElementById("word-count").textContent = `${words} words`;
  document.getElementById("char-count").textContent = `${text.length} chars`;
}

// Export / Import
function exportAllNotes() {
  const blob = new Blob([JSON.stringify(notes, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `notix-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  closeSettings();
}

function importNotes(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (Array.isArray(imported)) {
        notes = [...imported, ...notes];
        await saveNotesToStorage();
        renderNotesList();
        showToast("Notes imported successfully");
      }
    } catch { alert("Invalid JSON file"); }
  };
  reader.readAsText(file);
  closeSettings();
  e.target.value = "";
}

// Settings & Delete
function openSettings() {
  document.getElementById("settings-modal").style.display = "flex";
}

function closeSettings() {
  document.getElementById("settings-modal").style.display = "none";
}

async function deleteCurrentNote() {
  if (!currentNote || !confirm("Delete this note?")) return;
  notes = notes.filter((n) => n.id !== currentNote.id);
  await saveNotesToStorage();
  currentNote = null;
  editorPanelEl.style.display = "none";
  emptyStateEl.style.display = notes.length === 0 ? "flex" : "none";
  renderNotesList();
}

// Pin/Unpin Note
async function togglePinNote(noteId) {
  const note = notes.find((n) => n.id === noteId);
  if (!note) return;

  note.isPinned = !note.isPinned;
  note.updated = Date.now();

  if (currentNote && currentNote.id === noteId) {
    currentNote.isPinned = note.isPinned;
  }

  await saveNotesToStorage();
  renderNotesList();
}

async function deleteNoteById(noteId) {
  notes = notes.filter((n) => n.id !== noteId);
  await saveNotesToStorage();

  if (currentNote && currentNote.id === noteId) {
    currentNote = null;
    editorPanelEl.style.display = "none";
    emptyStateEl.style.display = notes.length === 0 ? "flex" : "none";
  }

  renderNotesList();
}

// Utilities
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  const text = document.getElementById("toast-text");
  if (!toast || !text) return;
  text.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

// XSS Protection
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

if (typeof browser === "undefined") window.browser = chrome;
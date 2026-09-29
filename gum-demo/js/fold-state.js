// Remembers which foldable sections (<details data-fold="name">) are open, so
// the layout stays the same after a reload. Stored in localStorage. Sections
// that were never toggled keep the default from the HTML (open attribute).

const STORAGE_KEY = 'gum-demo.fold';

function loadState() {
  try {
    const state = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable (private mode, quota). Folding still works.
  }
}

export function initFoldState(root = document) {
  const state = loadState();
  for (const details of root.querySelectorAll('details[data-fold]')) {
    const name = details.dataset.fold;
    if (typeof state[name] === 'boolean') {
      details.open = state[name];
    }
    details.addEventListener('toggle', () => {
      state[name] = details.open;
      saveState(state);
    });
  }
}

initFoldState();

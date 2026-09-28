// Keyboard and screen reader support for the CSS tooltips (data-tooltip).

/**
 * Gives each info icon under root an accessible name from its tooltip. Call
 * again after inserting HTML that contains info icons.
 */
export function labelInfoIcons(root = document) {
  for (const icon of root.querySelectorAll('.info-icon[data-tooltip]')) {
    icon.setAttribute('aria-label', `Info: ${icon.dataset.tooltip}`);
  }
}

/**
 * Labels the static info icons, and lets Esc hide the open tooltip until the
 * pointer or focus moves to another element.
 */
export function initTooltipA11y() {
  labelInfoIcons();
  const root = document.documentElement;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') root.classList.add('tooltips-dismissed');
  });
  const restore = () => root.classList.remove('tooltips-dismissed');
  document.addEventListener('mouseover', restore);
  document.addEventListener('focusin', restore);
}

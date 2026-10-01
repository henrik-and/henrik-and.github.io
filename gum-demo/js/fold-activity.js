// Activity hints for folded cards in preview.html. While the Track or RTP
// card is folded, its heading shows:
//   - a health dot: the current state (green / amber / red);
//   - a badge: the number of changes since the card was last open.
// The script only watches the DOM that main.js writes, so main.js is
// unchanged.

// Highlight renders closer together than this count as one change (for
// example applyConstraints updates getConstraints() and getSettings()).
const CHANGE_GROUP_MS = 500;

function setupCard({ details, badgeText, healthOf }) {
  const summary = details.querySelector(':scope > summary');
  const dot = document.createElement('span');
  dot.className = 'fold-health';
  const badge = document.createElement('span');
  badge.className = 'fold-badge';
  summary.append(dot, badge);

  let count = 0;
  let lastChange = 0;

  function render() {
    badge.textContent = count ? badgeText(count) : '';
    badge.classList.toggle('has-changes', count > 0);
  }

  function updateHealth() {
    const { state, label } = healthOf();
    if (state) {
      dot.dataset.state = state;
      dot.title = label;
    } else {
      delete dot.dataset.state;
      dot.removeAttribute('title');
    }
    details.closest('.card').dataset.health = state || '';
  }

  function change() {
    if (details.open) return;
    const now = performance.now();
    if (now - lastChange > CHANGE_GROUP_MS) {
      count++;
      render();
    }
    lastChange = now;
  }

  function reset() {
    count = 0;
    render();
  }

  details.addEventListener('toggle', () => { if (details.open) reset(); });
  return { change, reset, updateHealth };
}

function isNewHighlight(node) {
  return node.nodeType === Node.ELEMENT_NODE &&
      node.matches('.highlight, .highlight-green, .highlight-red') &&
      !node.classList.contains('fade-out');
}

// ---------- Track card ----------
const trackDetails = document.querySelector('#track-section-container > details.fold');
const trackProperties = document.getElementById('track-properties');
const trackCard = trackDetails && setupCard({
  details: trackDetails,
  badgeText: (n) => `${n} new change${n === 1 ? '' : 's'}`,
  healthOf: () => {
    const text = trackProperties.textContent;
    if (!text) return {};
    if (/"readyState":\s*"ended"/.test(text)) return { state: 'bad', label: 'Track ended' };
    if (/"muted":\s*true/.test(text)) return { state: 'warn', label: 'Track muted (no audio from the source)' };
    if (/"enabled":\s*false/.test(text)) return { state: 'warn', label: 'Track disabled (Track:Mute)' };
    return { state: 'ok', label: 'Track live' };
  },
});

if (trackCard) {
  // Highlighted lines in the panes: applyConstraints results and changed
  // track properties.
  new MutationObserver((mutations) => {
    if (mutations.some((m) => [...m.addedNodes].some(isNewHighlight))) trackCard.change();
    trackCard.updateHealth();
  }).observe(document.getElementById('track-settings-container'), { childList: true, subtree: true });
}

// ---------- RTP card ----------
const rtpDetails = document.getElementById('rtp-stats-details');
const playout = document.getElementById('audio-playout-stats');
const rtpCard = rtpDetails && setupCard({
  details: rtpDetails,
  badgeText: (n) => `${n} new glitch${n === 1 ? '' : 'es'}`,
  healthOf: () => {
    const badge = playout.querySelector('.glitch-badge');
    if (!badge) return {};
    if (badge.classList.contains('glitch-badge-error')) return { state: 'bad', label: `Playout: ${badge.textContent}` };
    if (badge.classList.contains('glitch-badge-warning')) return { state: 'warn', label: `Playout: ${badge.textContent}` };
    return { state: 'ok', label: 'Playout: clean' };
  },
});

if (rtpCard) {
  let glitchActive = playout.classList.contains('glitch-active');
  new MutationObserver(() => {
    const now = playout.classList.contains('glitch-active');
    if (now && !glitchActive) rtpCard.change();
    glitchActive = now;
    rtpCard.updateHealth();
  }).observe(playout, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
}

// ---------- Stream stop: clear counts and health ----------
const streamControls = document.getElementById('stream-controls-container');
new MutationObserver(() => {
  if (!streamControls.hidden) return;
  for (const card of [trackCard, rtpCard]) {
    if (!card) continue;
    card.reset();
    card.updateHealth();
  }
}).observe(streamControls, { attributes: true, attributeFilter: ['hidden'] });

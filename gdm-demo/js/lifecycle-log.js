// Lifecycle Activity Log: the on-page event list, also exported in the snapshot.

import { debugLog, escapeHtml } from './util.js';

export const lifecycleEvents = [];

export function logLifecycleEvent(category, message, level = 'info') {
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
  const entry = { time: timeStr, category, message, level };
  lifecycleEvents.push(entry);

  const logContainer = document.getElementById('lifecycle-events-log');
  const countSpan = document.getElementById('lifecycle-events-count');

  if (countSpan) {
    countSpan.textContent = `${lifecycleEvents.length} event${lifecycleEvents.length !== 1 ? 's' : ''}`;
  }

  if (logContainer) {
    const line = document.createElement('div');
    line.className = `lifecycle-event-line event-${level}`;

    let marker = '';
    if (level === 'error') marker = '<span class="event-marker">⛔</span>';
    else if (level === 'warning') marker = '<span class="event-marker">⚠️</span>';
    else if (level === 'success') marker = '<span class="event-marker">✅</span>';

    line.innerHTML = `${marker}<span class="event-timestamp">[${timeStr}]</span> <strong>${escapeHtml(category)}:</strong> ${escapeHtml(message)}`;
    logContainer.appendChild(line);
    logContainer.scrollTop = logContainer.scrollHeight;
  }
  debugLog(`[Lifecycle] [${level.toUpperCase()}] ${timeStr} [${category}] ${message}`);
}

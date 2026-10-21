// Small helpers shared by all modules.

// Verbose logging is off by default. Add ?debug (or ?debug=1) to the URL to
// turn it on. console.warn and console.error are always shown.
export const DEBUG = (() => {
  const params = new URLSearchParams(window.location.search);
  return params.has('debug') && params.get('debug') !== '0';
})();
export const debugLog = DEBUG ? console.log.bind(console) : () => {};

/**
 * Escapes text for safe insertion into HTML. Use for any value that does not
 * originate from this page (device/track labels, file names, error messages).
 */
export function escapeHtml(value) {
  return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
}

/**
 * Creates an AudioContext that does not open a physical output device.
 * Used for internal-only graphs (level meter, sine-tone generator) so they
 * do not add extra output streams that would skew latency, render quantum,
 * or glitch measurements of the context under test. Falls back to a regular
 * AudioContext on browsers without AudioContext sinkId support.
 */
export function createSilentAudioContext() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype) {
    try {
      return new Ctor({ sinkId: { type: 'none' } });
    } catch (e) {
      console.warn('Silent-sink AudioContext not supported, using default output:', e);
    }
  }
  return new Ctor();
}

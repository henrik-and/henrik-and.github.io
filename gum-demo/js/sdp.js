// SDP munging for the local PeerConnection loopback.

import { debugLog } from './util.js';

/**
 * Modifies an SDP string to add stereo support for the Opus codec.
 * @param {string} sdp The original SDP string.
 * @returns {string} The modified SDP string with stereo support for Opus.
 */
export const insertStereoSupportForOpus = (sdp) => {
  // Early exit if Opus codec (rtpmap:111) is not present.
  if (!sdp.includes('a=rtpmap:111 opus/48000')) {
    console.warn('Opus codec (111) not found in SDP. Stereo support not added.');
    return sdp;
  }

  // Find the format parameter line for Opus and add stereo=1 if it's not already there.
  const lines = sdp.split('\r\n');
  const newSdpLines = lines.map((line) => {
    if (line.startsWith('a=fmtp:111') && !line.includes('stereo=1')) {
      debugLog('Adding stereo=1 to Opus fmtp line.');
      return `${line};stereo=1`;
    }
    return line;
  });

  return newSdpLines.join('\r\n');
};

/**
 * Modifies an SDP string to enable Discontinuous Transmission (DTX) for the Opus codec.
 * @param {string} sdp The original SDP string.
 * @returns {string} The modified SDP string with DTX enabled for Opus.
 */
export const insertDtxSupportForOpus = (sdp) => {
  // Early exit if Opus codec (rtpmap:111) is not present.
  if (!sdp.includes('a=rtpmap:111 opus/48000')) {
    console.warn('Opus codec (111) not found in SDP. DTX support not added.');
    return sdp;
  }

  // Find the format parameter line for Opus and add usedtx=1 if it's not already there.
  const lines = sdp.split('\r\n');
  const newSdpLines = lines.map((line) => {
    if (line.startsWith('a=fmtp:111') && !line.includes('usedtx=1')) {
      debugLog('Adding usedtx=1 to Opus fmtp line.');
      return `${line};usedtx=1`;
    }
    return line;
  });

  return newSdpLines.join('\r\n');
};

// Live level meter (green bar and dBFS readout) and the pc2 audioLevel label.

import { createSilentAudioContext } from './util.js';

const visualizerCanvas = document.querySelector('#audio-visualizer');
const canvasCtx = visualizerCanvas.getContext('2d');
let audioContext = null;
let analyser = null;
let visualizerFrameRequest = null;
let visualizerDataArray = null;
const visualizerDbLabel = document.getElementById('visualizer-db-label');
// The dBFS readout is averaged over this window so it is readable for speech.
const VISUALIZER_DB_LABEL_INTERVAL_MS = 250;
let visualizerDbSumSquares = 0;
let visualizerDbSampleCount = 0;
let visualizerDbLastUpdate = 0;

export function stopVisualizer() {
  if (visualizerFrameRequest !== null) {
    cancelAnimationFrame(visualizerFrameRequest);
    visualizerFrameRequest = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  analyser = null;
  canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
  visualizerDbSumSquares = 0;
  visualizerDbSampleCount = 0;
  visualizerDbLastUpdate = 0;
  if (visualizerDbLabel) {
    visualizerDbLabel.textContent = '';
    visualizerDbLabel.classList.remove('active');
    visualizerDbLabel.hidden = true;
  }
}

// Level meter range in dBFS. The bar is empty at or below the floor and full at 0 dBFS.
const VISUALIZER_DB_FLOOR = -60;

export function visualizeAudio(stream) {
  stopVisualizer();
  audioContext = createSilentAudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  visualizerDataArray = new Float32Array(analyser.fftSize);
  source.connect(analyser);
  drawVisualizer();
}

function updateVisualizerDbLabel(now) {
  if (!visualizerDbLabel || visualizerDbSampleCount === 0) return;
  if (now - visualizerDbLastUpdate < VISUALIZER_DB_LABEL_INTERVAL_MS) return;
  const rms = Math.sqrt(visualizerDbSumSquares / visualizerDbSampleCount);
  const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  const text = db > -100 ? db.toFixed(1) : '-∞';
  visualizerDbLabel.innerHTML = `<span class="rms-key">Level:</span><span class="rms-val">${text} dBFS</span>`;
  visualizerDbLabel.classList.toggle('active', db > VISUALIZER_DB_FLOOR);
  visualizerDbLabel.hidden = false;
  visualizerDbSumSquares = 0;
  visualizerDbSampleCount = 0;
  visualizerDbLastUpdate = now;
}

function drawVisualizer(now = performance.now()) {
  if (!audioContext || audioContext.state === 'closed' || !analyser) {
    visualizerFrameRequest = null;
    canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    return;
  }
  visualizerFrameRequest = requestAnimationFrame(drawVisualizer);
  // Use the RMS of the time-domain signal. Averaging frequency bins (the old
  // approach) shows almost nothing for narrowband signals like a pure tone,
  // because only one or two bins carry energy.
  analyser.getFloatTimeDomainData(visualizerDataArray);
  let sumSquares = 0;
  for (let i = 0; i < visualizerDataArray.length; i++) {
    sumSquares += visualizerDataArray[i] * visualizerDataArray[i];
  }
  visualizerDbSumSquares += sumSquares;
  visualizerDbSampleCount += visualizerDataArray.length;
  updateVisualizerDbLabel(now);
  const rms = Math.sqrt(sumSquares / visualizerDataArray.length);
  const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  const level = Math.min(1, Math.max(0, (db - VISUALIZER_DB_FLOOR) / -VISUALIZER_DB_FLOOR));
  canvasCtx.fillStyle = 'rgb(250, 250, 250)';
  canvasCtx.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
  const barWidth = level * visualizerCanvas.width;
  canvasCtx.fillStyle = '#00FF00';
  canvasCtx.fillRect(0, 0, barWidth, visualizerCanvas.height);
}

/**
 * Shows the pc2 audioLevel label. level is the latest 1-second value
 * (linear, 0 to 1) or null if no value is available yet.
 */
export function showAudioLevelLabel(level) {
  const rmsLabel = document.getElementById('visualizer-rms-label');
  if (!rmsLabel) return;
  const isActive = (level !== null && level >= 0.0007);
  const text1s = (level !== null && level > 0)
      ? Number(level).toFixed(5)
      : '0.00000';
  rmsLabel.classList.toggle('active', isActive);
  rmsLabel.innerHTML = `<span class="rms-key">audioLevel:</span><span class="rms-val">${text1s}</span>`;
  rmsLabel.setAttribute(
      'data-tooltip',
      'Received audio level at pc2 over the latest 1-second stats interval, from the inbound-rtp getStats() report: ' +
      'sqrt(ΔtotalAudioEnergy / ΔtotalSamplesDuration). Linear scale, 0 to 1. ' +
      'libwebrtc computes audioLevel from the peak sample value, so this is an energy average of peak levels, not the RMS of the signal. ' +
      'Example: a sine with peak 0.2 shows 0.2 here, but -17.0 dBFS (RMS 0.141) on the level meter above. ' +
      'Green when >= 0.0007. Audio must be rendered (HTML:Play or WebAudio:Play) for pc2 to report non-zero values.'
  );
  rmsLabel.hidden = false;
}

export function hideAudioLevelLabel() {
  const rmsLabel = document.getElementById('visualizer-rms-label');
  if (!rmsLabel) return;
  rmsLabel.textContent = '';
  rmsLabel.classList.remove('active');
  rmsLabel.removeAttribute('data-tooltip');
  rmsLabel.hidden = true;
}

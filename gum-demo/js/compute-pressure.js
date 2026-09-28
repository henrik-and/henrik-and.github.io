// Compute Pressure API (CPU): observer, simulation, status badge and history graph.

import { debugLog, escapeHtml } from './util.js';
import { logLifecycleEvent } from './lifecycle-log.js';

let computePressureObserver = null;
// Read by main.js for System Diagnostics and the snapshot.
export let latestComputePressure = { state: 'Unknown', factors: [], sampleCount: 0, lastSampleTime: null, isSimulated: false };
let simulationTimer = null;
export const computePressureHistory = [];
const MAX_PRESSURE_HISTORY_POINTS = 30;

export function getComputePressureValue(state) {
  switch (state) {
    case 'nominal': return 25;
    case 'fair': return 50;
    case 'serious': return 75;
    case 'critical': return 100;
    default: return 25;
  }
}

export function getComputePressureColor(state) {
  switch (state) {
    case 'nominal': return '#2E7D32'; // Green (light)
    case 'fair': return '#F57F17';    // Yellow/Amber (moderate)
    case 'serious': return '#E65100'; // Orange (high)
    case 'critical': return '#C62828';// Red (heavy)
    default: return '#757575';
  }
}

export function addComputePressureHistoryPoint(state, factors = [], isSimulated = false) {
  const val = getComputePressureValue(state);
  computePressureHistory.push({
    time: Date.now(),
    state: state,
    value: val,
    factors: factors || [],
    isSimulated: isSimulated
  });
  if (computePressureHistory.length > MAX_PRESSURE_HISTORY_POINTS) {
    computePressureHistory.shift();
  }
  renderComputePressureGraph();
}

export function renderComputePressureGraph() {
  const canvas = document.getElementById('compute-pressure-canvas');
  if (!canvas) return;
  const container = document.getElementById('compute-pressure-graph-container');
  if (container) {
    const containerW = Math.floor(container.clientWidth - 18);
    if (containerW > 100 && canvas.width !== containerW) {
      canvas.width = containerW;
    }
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;

  // Background
  ctx.fillStyle = '#fafbfc';
  ctx.fillRect(0, 0, width, height);

  // Padding for axes
  const padLeft = 82;
  const padRight = 14;
  const padTop = 10;
  const padBottom = 16;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  // Levels mapping according to Google Meet Web design
  const levels = [
    { label: 'heavy (100%)', val: 100, color: '#C62828' },
    { label: 'high (75%)', val: 75, color: '#E65100' },
    { label: 'moderate (50%)', val: 50, color: '#F57F17' },
    { label: 'light (25%)', val: 25, color: '#2E7D32' },
  ];

  // Draw horizontal grid lines and level labels
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = '9px "Lucida Console", monospace';

  levels.forEach(lvl => {
    // Linear mapping: 20% to 105% onto plot area
    const y = padTop + plotH - ((lvl.val - 20) / 85) * plotH;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = lvl.color;
    ctx.fillText(lvl.label, padLeft - 6, y);
  });

  // Time axis marks
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#888';
  ctx.fillText('-30s', padLeft, padTop + plotH + 3);
  ctx.fillText('-15s', padLeft + plotW / 2, padTop + plotH + 3);
  ctx.fillText('now', padLeft + plotW, padTop + plotH + 3);

  if (computePressureHistory.length === 0) return;

  // Prepare point coordinates
  const n = computePressureHistory.length;
  const stepX = plotW / (MAX_PRESSURE_HISTORY_POINTS - 1);
  const startX = padLeft + (MAX_PRESSURE_HISTORY_POINTS - n) * stepX;

  const points = computePressureHistory.map((pt, i) => {
    const x = startX + i * stepX;
    const y = padTop + plotH - ((pt.value - 20) / 85) * plotH;
    return { x, y, state: pt.state, val: pt.value, color: getComputePressureColor(pt.state) };
  });

  if (points.length === 1) {
    ctx.fillStyle = points[0].color;
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, 4, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Step-line path for area and stroke (preserving discrete state shifts)
  const stepPoints = [];
  stepPoints.push({ x: points[0].x, y: points[0].y, color: points[0].color });
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    stepPoints.push({ x: curr.x, y: prev.y, color: prev.color });
    stepPoints.push({ x: curr.x, y: curr.y, color: curr.color });
  }

  // Draw shaded area under curve
  ctx.beginPath();
  ctx.moveTo(stepPoints[0].x, padTop + plotH);
  for (let i = 0; i < stepPoints.length; i++) {
    ctx.lineTo(stepPoints[i].x, stepPoints[i].y);
  }
  ctx.lineTo(stepPoints[stepPoints.length - 1].x, padTop + plotH);
  ctx.closePath();

  const lastPt = points[points.length - 1];
  const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
  grad.addColorStop(0, `${lastPt.color}33`);
  grad.addColorStop(1, `${lastPt.color}05`);
  ctx.fillStyle = grad;
  ctx.fill();

  // Draw step line segments
  for (let i = 0; i < stepPoints.length - 1; i++) {
    const p1 = stepPoints[i];
    const p2 = stepPoints[i + 1];
    ctx.strokeStyle = p2.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  // Draw markers at actual samples
  points.forEach((p, idx) => {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    const isLatest = (idx === points.length - 1);
    ctx.arc(p.x, p.y, isLatest ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (isLatest) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  });
}

export function setComputePressureState(newState, factors = [], isSimulated = false) {
  const prevState = latestComputePressure.state;
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];

  latestComputePressure = {
    state: newState,
    factors: factors || [],
    sampleCount: (latestComputePressure.sampleCount || 0) + 1,
    lastSampleTime: timeStr,
    time: now.toISOString(),
    isSimulated: isSimulated
  };

  addComputePressureHistoryPoint(newState, factors, isSimulated);

  const factorText = factors && factors.length > 0 ? ` (factors: ${factors.join(', ')})` : '';
  const simText = isSimulated ? ' [simulated]' : '';

  if (prevState === 'Unknown') {
    logLifecycleEvent('ComputePressure', `Observer active (initial state: ${newState}${factorText})${simText}`, 'info');
  } else if (prevState !== newState) {
    let level = 'info';
    if (newState === 'critical') level = 'error';
    else if (newState === 'serious') level = 'warning';
    else if (newState === 'nominal') level = 'success';

    logLifecycleEvent('ComputePressure', `CPU pressure transitioned: ${prevState} -> ${newState}${factorText}${simText}`, level);
  }

  updateComputePressureUI();
}

export function runComputePressureCycle() {
  if (simulationTimer) {
    clearInterval(simulationTimer);
    simulationTimer = null;
  }
  const states = ['nominal', 'fair', 'serious', 'critical', 'serious', 'fair', 'nominal'];
  let idx = 0;
  const btn = document.getElementById('simulate-pressure-cycle-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Simulating Cycle...';
  }

  setComputePressureState(states[idx], idx >= 3 ? ['thermal'] : [], true);

  simulationTimer = setInterval(() => {
    idx++;
    if (idx >= states.length) {
      clearInterval(simulationTimer);
      simulationTimer = null;
      const b = document.getElementById('simulate-pressure-cycle-btn');
      if (b) {
        b.disabled = false;
        b.textContent = 'Simulate Cycle';
      }
      return;
    }
    const state = states[idx];
    const factors = (state === 'serious' || state === 'critical') ? ['thermal'] : [];
    setComputePressureState(state, factors, true);
  }, 1500);
}

export function getComputePressureBadge(state) {
  switch (state) {
    case 'nominal':
      return '<span class="cp-state cp-nominal">🟢 Nominal (Light load)</span>';
    case 'fair':
      return '<span class="cp-state cp-fair">🟡 Fair (Moderate load)</span>';
    case 'serious':
      return '<span class="cp-state cp-serious">🟠 Serious (High load)</span>';
    case 'critical':
      return '<span class="cp-state cp-critical">🔴 Critical (Heavy load)</span>';
    default:
      return `<span class="cp-unknown">${escapeHtml(state)}</span>`;
  }
}

export function formatComputePressureHtml(pressure) {
  const isSupported = typeof PressureObserver !== 'undefined';
  const stateBadge = getComputePressureBadge(pressure ? pressure.state : 'Unknown');
  const factorsText = (pressure && pressure.factors && pressure.factors.length > 0)
    ? ` <small class="cp-factors">[factors: ${escapeHtml(pressure.factors.join(', '))}]</small>`
    : '';
  const sampleMeta = (pressure && pressure.lastSampleTime)
    ? ` <small class="cp-sample-meta">(last: ${pressure.lastSampleTime}, count: ${pressure.sampleCount}${pressure.isSimulated ? ', simulated' : ''})</small>`
    : '';

  return `${stateBadge}${factorsText}${sampleMeta}`;
}

export function updateComputePressureUI() {
  const el = document.getElementById('compute-pressure-status');
  if (el) {
    el.innerHTML = formatComputePressureHtml(latestComputePressure);
  }
  const summaryBadge = document.getElementById('summary-compute-pressure-badge');
  if (summaryBadge) {
    if (typeof PressureObserver === 'undefined' && !latestComputePressure.isSimulated) {
      summaryBadge.textContent = '[CPU: N/A]';
      summaryBadge.classList.add('na');
    } else if (latestComputePressure.state !== 'Unknown') {
      let icon = '🟢';
      if (latestComputePressure.state === 'fair') icon = '🟡';
      else if (latestComputePressure.state === 'serious') icon = '🟠';
      else if (latestComputePressure.state === 'critical') icon = '🔴';
      summaryBadge.textContent = `[CPU: ${icon} ${latestComputePressure.state.toUpperCase()}${latestComputePressure.isSimulated ? ' (sim)' : ''}]`;
      summaryBadge.classList.remove('na');
    }
  }
  renderComputePressureGraph();
}

export async function initComputePressureObserver() {
  if (typeof PressureObserver === 'undefined') {
    debugLog('Compute Pressure API (PressureObserver) not supported in this browser.');
    latestComputePressure = { state: 'nominal', factors: [], sampleCount: 0, lastSampleTime: null, isSimulated: false };
    updateComputePressureUI();
    return;
  }
  try {
    computePressureObserver = new PressureObserver((records) => {
      if (!records || records.length === 0) return;
      if (simulationTimer) return; // Do not overwrite active simulated cycle
      const latest = records[records.length - 1];
      setComputePressureState(latest.state, latest.factors || [], false);
    });

    await computePressureObserver.observe('cpu', { sampleInterval: 1000 });
    debugLog('Compute Pressure API observer initialized on source "cpu".');
  } catch (err) {
    console.warn('Failed to start PressureObserver:', err);
    latestComputePressure = { state: `Error: ${err.message}`, factors: [], sampleCount: 0, lastSampleTime: null, isSimulated: false };
    updateComputePressureUI();
  }
}

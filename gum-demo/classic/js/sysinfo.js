// Browser, OS and audio hardware info for System Diagnostics and the snapshot.

// Cached result of a single default-options AudioContext probe. Creating a
// context opens an output stream, so we probe once and only re-probe after a
// devicechange (the default output device may have changed).
let cachedAudioHardwareInfo = null;

/** Forces a new probe on the next getAudioHardwareInfo() call. */
export function invalidateAudioHardwareInfo() {
  cachedAudioHardwareInfo = null;
}

export function getAudioHardwareInfo() {
  if (cachedAudioHardwareInfo) return cachedAudioHardwareInfo;
  const info = {
    hwSampleRate: 'N/A',
    hwBaseLatency: 'N/A',
    hwOutputLatency: 'N/A',
    hwRenderQuantum: 'N/A',
  };
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return info;
  try {
    const probeCtx = new Ctor();
    info.hwSampleRate = `${probeCtx.sampleRate} Hz`;
    if (typeof probeCtx.baseLatency === 'number') {
      info.hwBaseLatency = `${(probeCtx.baseLatency * 1000).toFixed(1)} ms`;
    }
    if (typeof probeCtx.outputLatency === 'number') {
      info.hwOutputLatency = `${(probeCtx.outputLatency * 1000).toFixed(1)} ms`;
    }
    info.hwRenderQuantum = (typeof probeCtx.renderQuantumSize === 'number')
        ? `${probeCtx.renderQuantumSize} samples`
        : '128 (default/legacy)';
    probeCtx.close();
    cachedAudioHardwareInfo = info;
  } catch (e) {
    console.warn('Probe AudioContext error:', e);
  }
  return info;
}

export function getBrowserInfo() {
  const ua = navigator.userAgent;
  let tem;
  let M = ua.match(/(opera|chrome|safari|firefox|msie|trident(?=\/))\/?\s*(\d+)/i) || [];
  if (/trident/i.test(M[1])) {
    tem = /\brv[ :]+(\d+)/g.exec(ua) || [];
    return { name: 'IE', version: (tem[1] || '') };
  }
  if (M[1] === 'Chrome') {
    tem = ua.match(/\b(OPR|Edg)\/(\d+)/);
    if (tem != null) return { name: tem[1].replace('OPR', 'Opera'), version: tem[2] };
  }
  M = M[2] ? [M[1], M[2]] : [navigator.appName, navigator.appVersion, '-?'];
  if ((tem = ua.match(/version\/(\d+)/i)) != null) M.splice(1, 1, tem[1]);
  return {
    name: M[0],
    version: M[1]
  };
}

export function getOSInfo() {
  const ua = navigator.userAgent;
  if (ua.indexOf("Win") !== -1) return "Windows";
  if (ua.indexOf("Mac") !== -1) return "MacOS";
  if (ua.indexOf("Linux") !== -1) return "Linux";
  if (ua.indexOf("Android") !== -1) return "Android";
  if (ua.indexOf("like Mac") !== -1) return "iOS";
  return "Unknown OS";
}

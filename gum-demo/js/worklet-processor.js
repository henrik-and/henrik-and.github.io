// AudioWorkletProcessor definitions for DualThread RTC WebAudio playout.
//
// Attaching an AudioWorkletNode to an AudioContext switches Chromium's
// RealtimeAudioDestinationHandler into DualThread mode (AudioDeviceThread +
// AudioWorkletThread with WebAudioBypassOutputBuffering on Desktop) and enables
// WebAudio.AudioDestination.DualThread.*.{LatencyBalanced,...} UMA reporting.
//
// Both processors run zero heap allocations inside process() and adapt to any
// negotiated renderQuantumSize (e.g. 480 frames / 10 ms @ 48 kHz, or 128).

class RtcBufferPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.channels = Array.isArray(opts.channels) ? opts.channels : [];
    this.numFrames = this.channels.length > 0 ? this.channels[0].length : 0;
    this.readIndex = 0;
    this.running = true;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'stop') {
        this.running = false;
        this.channels = [];
        this.numFrames = 0;
      }
    };
  }

  process(inputs, outputs) {
    if (!this.running) return false;
    const output = outputs[0];
    if (!output || output.length === 0 || this.numFrames === 0) {
      return true;
    }

    const blockFrames = output[0].length;
    const srcChannels = this.channels;
    const srcCount = srcChannels.length;
    const totalFrames = this.numFrames;

    for (let ch = 0; ch < output.length; ch++) {
      const outCh = output[ch];
      const srcCh = srcChannels[ch < srcCount ? ch : 0];
      let idx = this.readIndex;
      for (let i = 0; i < blockFrames; i++) {
        outCh[i] = srcCh[idx];
        idx++;
        if (idx >= totalFrames) idx = 0;
      }
    }

    this.readIndex = (this.readIndex + blockFrames) % totalFrames;
    return true;
  }
}

class RtcPassthroughProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.running = true;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'stop') {
        this.running = false;
      }
    };
  }

  process(inputs, outputs) {
    if (!this.running) return false;
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    if (!input || input.length === 0) return true;

    const inCount = input.length;
    for (let ch = 0; ch < output.length; ch++) {
      const inCh = input[ch < inCount ? ch : 0];
      const outCh = output[ch];
      if (inCh && inCh.length === outCh.length) {
        outCh.set(inCh);
      } else if (inCh) {
        const len = Math.min(inCh.length, outCh.length);
        for (let i = 0; i < len; i++) {
          outCh[i] = inCh[i];
        }
      }
    }
    return true;
  }
}

registerProcessor('rtc-buffer-player', RtcBufferPlayerProcessor);
registerProcessor('rtc-passthrough-processor', RtcPassthroughProcessor);

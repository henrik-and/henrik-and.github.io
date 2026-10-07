// AudioWorklet processor that copies input channel 0 to the main thread in
// batches. Each message carries the context frame index of its first sample,
// so the main thread can spot gaps.

const BATCH_FRAMES = 2048;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(BATCH_FRAMES);
    this.fill = 0;
    this.batchStartFrame = -1;
    this.emptyQuanta = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') this.flush();
    };
  }

  flush() {
    if (this.fill > 0) {
      this.port.postMessage({
        startFrame: this.batchStartFrame,
        data: this.buf.slice(0, this.fill),
        emptyQuanta: this.emptyQuanta,
      });
    }
    this.fill = 0;
    this.batchStartFrame = -1;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) {
      this.emptyQuanta++;
      return true;
    }
    if (this.batchStartFrame < 0) this.batchStartFrame = currentFrame;
    this.buf.set(ch, this.fill);
    this.fill += ch.length;
    if (this.fill + ch.length > BATCH_FRAMES) this.flush();
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);

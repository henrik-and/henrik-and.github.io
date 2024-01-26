'use strict';

function transform(frame, controller) {
  // Cropping from an existing video frame is supported by the API in Chrome 94+.
  // https://www.w3.org/TR/webcodecs/#videoframe-interface
  // https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame/VideoFrame#visiblerect
  const newFrame = new VideoFrame(frame, {
    visibleRect: {
      x: 640,
      width: 640,
      y: 360,
      height: 200,
    }
  });
  controller.enqueue(newFrame);
  frame.close();
}

onmessage = async (event) => {
  const {operation} = event.data;
  console.log('[Crop worker] message=' + operation);
  if (operation === 'crop') {
    const {readable, writable} = event.data;
    readable
        .pipeThrough(new TransformStream({transform}))
        .pipeTo(writable);
  } else {
    console.error('Unknown operation', operation);
  }
};
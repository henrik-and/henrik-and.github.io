'use strict';

let cropRect;

const defaultVisibleRect = {x: 640, y: 360, width: 640, height: 360};

function transform(frame, controller) {
  // Cropping from an existing video frame is supported by the API in Chrome 94+.
  // https://www.w3.org/TR/webcodecs/#videoframe-interface
  // https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame/VideoFrame#visiblerect
  try {
    const newFrame = new VideoFrame(frame, {
      visibleRect: cropRect
    });
    controller.enqueue(newFrame);
    frame.close();
  } catch (e) {
    console.error(`DOMException: ${e.name} [${e.message}]`);
    frame.close();
    // TODO(henrika): improve recovery here. For now, retsoring a visibleRect
    // which we know works.
    cropRect = defaultVisibleRect;
  }
}

onmessage = async (event) => {
  const {operation} = event.data;
  console.log('[Crop worker] message=' + operation);
  if (operation === 'crop') {
    const {readable, writable} = event.data;
    // https://developer.mozilla.org/en-US/docs/Web/API/TransformStream
    readable
        .pipeThrough(new TransformStream({transform}))
        .pipeTo(writable);
  } else if (operation === 'change') {
    cropRect = event.data.cropRect;
    console.log('visibleRect: ', cropRect);
  } else {
    console.error('Unknown operation', operation);
  }
};
'use strict';

let cropRect;

const defaultVisibleRect = {x: 640, y: 360, width: 640, height: 360};

function cropTransform(frame, controller) {
  // Cropping from an existing video frame is supported by the API in Chrome 94+.
  // https://www.w3.org/TR/webcodecs/#videoframe-interface
  // https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame/VideoFrame#visiblerect
  // Example of VideoFrame:
  // Before:                  After:
  // {                        {
  // "format": "I420",        "format": "I420",
  // "visibleRect": {         "visibleRect": {
  //   "x": 0,                  "x": 640,
  //   "y": 0,                  "y": 360,
  //   "width": 1280,           "width": 640,
  //   "height": 720,           "height": 360,
  //   "top": 0,                "top": 360,
  //   "right": 1280,           "right": 1280,
  //   "bottom": 720,           "bottom": 720,
  //   "left": 0                "left": 640
  // },                       },
  // "codedWidth": 1280,      "codedWidth": 1280,
  // "codedHeight": 720,      "codedHeight": 720,
  // "colorSpace": {          "colorSpace": {
  //   "fullRange": false,      "fullRange": false,
  //   "matrix": "smpte170m",   "matrix": "smpte170m",
  //   "primaries": "bt709",    "primaries": "bt709",
  //   "transfer": "bt709"      "transfer": "bt709"
  // },                       }, 
  // "displayHeight": 720,    "displayHeight": 360,
  // "displayWidth": 1280     "displayWidth": 640  
  // }                         }
  try {
    const newFrame = new VideoFrame(frame, {
      visibleRect: cropRect
    });
    controller.enqueue(newFrame);
    frame.close();
  } catch (e) {
    const message = `DOMException: ${e.name} [${e.message}]`; 
    console.error(message);
    postMessage({
      operation: 'exception',
      error: message,
    });
    frame.close();
    cropRect = defaultVisibleRect;
  }
}

// Crops but also upscales the result to HD (1280x720).
function cropAndUpscaleTransform(frame, controller) {
  try {
    const newFrame = new VideoFrame(frame, {
      visibleRect: cropRect,
      displayWidth: 1280,
      displayHeight: 720,
    });
    controller.enqueue(newFrame);
    frame.close();
  } catch (e) {
    const message = `DOMException: ${e.name} [${e.message}]`; 
    console.error(message);
    postMessage({
      operation: 'exception',
      error: message,
    });
    frame.close();
  }
}

onmessage = async (event) => {
  const {operation} = event.data;
  console.log('[Crop worker] message=' + operation);
  if (operation === 'crop') {
    const {readable, writable} = event.data;
    // https://developer.mozilla.org/en-US/docs/Web/API/TransformStream
    readable
        .pipeThrough(new TransformStream({transform: cropTransform}))
        .pipeTo(writable);
  } else if (operation === 'cropscale') {
    const {readable, writable} = event.data;
    readable
        .pipeThrough(new TransformStream({transform: cropAndUpscaleTransform}))
        .pipeTo(writable);
  } else if (operation === 'change') {
    cropRect = event.data.cropRect;
    console.log('visibleRect: ', cropRect);
  } else {
    console.error('Unknown operation', operation);
  }
};
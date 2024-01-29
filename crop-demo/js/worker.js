'use strict';

let cropRect;

const TransformType = Object.freeze({
  CROP: 1,
  CROPSCALE: 2,
});
let selectedTransform;

const defaultVisibleRect = {x: 640, y: 360, width: 640, height: 360};

let loggedFrameProperties;

const prettyJson = (obj) => JSON.stringify(obj, null, 2);

const logFrameProperties = (videoFrame, stage) => {
  if (loggedFrameProperties) {
    return;
  }
  const transforms = ['Crop', 'Crop+Upscale'];
  // TODO(henrika): figure out why we need this copy to be able to see all
  // essential properties in the debug console.
  const internalFrame = {};
  internalFrame.format = videoFrame.format;
  internalFrame.visibleRect = videoFrame.visibleRect;
  internalFrame.codedWidth = videoFrame.codedWidth;
  internalFrame.codedHeight = videoFrame.codedHeight;
  internalFrame.colorSpace = videoFrame.colorSpace;
  internalFrame.displayHeight = videoFrame.displayHeight;
  internalFrame.displayWidth = videoFrame.displayWidth;
  console.log(`[${transforms[selectedTransform - 1]}][${stage}] Video Frame: ` + prettyJson(internalFrame));
  if (stage === 'after') {
    loggedFrameProperties = true;
  }
};

function transform(frame, controller) {
  // Cropping from an existing video frame is supported by the API in Chrome 94+.
  // https://www.w3.org/TR/webcodecs/#videoframe-interface
  // https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame/VideoFrame#visiblerect
  //
  // Example of VideoFrame without upscaling:
  //
  //  Before:                  After:
  //  {                        {
  //  "format": "I420",        "format": "I420",
  //  "visibleRect": {         "visibleRect": {
  //    "x": 0,                  "x": 640,
  //    "y": 0,                  "y": 360,
  //    "width": 1280,           "width": 640,
  //    "height": 720,           "height": 360,
  //    "top": 0,                "top": 360,
  //    "right": 1280,           "right": 1280,
  //    "bottom": 720,           "bottom": 720,
  //    "left": 0                "left": 640
  //  },                       },
  //  "codedWidth": 1280,      "codedWidth": 1280,
  //  "codedHeight": 720,      "codedHeight": 720,
  //  "colorSpace": {          "colorSpace": {
  //    "fullRange": false,      "fullRange": false,
  //    "matrix": "smpte170m",   "matrix": "smpte170m",
  //    "primaries": "bt709",    "primaries": "bt709",
  //    "transfer": "bt709"      "transfer": "bt709"
  //  },                       }, 
  //  "displayHeight": 720,    "displayHeight": 360,
  //  "displayWidth": 1280     "displayWidth": 640  
  // }                         }
  try {
    logFrameProperties(frame, 'before');
    let newFrame;
    if (selectedTransform === TransformType.CROP) {
      newFrame = new VideoFrame(frame, {
        visibleRect: cropRect
      });
    } else if (selectedTransform === TransformType.CROPSCALE) {
      newFrame = new VideoFrame(frame, {
        visibleRect: cropRect,
        displayWidth: 1280,
        displayHeight: 720,
      });
    } else {
      console.error('[Crop worker] Unknown transform', selectedTransform);
    }
    logFrameProperties(newFrame, 'after');
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

onmessage = async (event) => {
  const {operation} = event.data;
  console.log('[Crop worker] message=' + operation);
  if (operation === 'crop') {
    loggedFrameProperties = false;
    selectedTransform = TransformType.CROP;
    const {readable, writable} = event.data;
    // https://developer.mozilla.org/en-US/docs/Web/API/TransformStream
    readable
        .pipeThrough(new TransformStream({transform}))
        .pipeTo(writable);
  } else if (operation === 'cropscale') {
    loggedFrameProperties = false;
    selectedTransform = TransformType.CROPSCALE;
    const {readable, writable} = event.data;
    readable
        .pipeThrough(new TransformStream({transform}))
        .pipeTo(writable);
  } else if (operation === 'change') {
    cropRect = event.data.cropRect;
    console.log('[Crop worker] visibleRect: ', cropRect);
  } else {
    console.error('[Crop worker] Unknown operation', operation);
  }
};
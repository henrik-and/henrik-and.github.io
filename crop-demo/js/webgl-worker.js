'use strict';

const defaultVisibleRect = {x: 640, y: 360, width: 640, height: 360};

let cropRect;
let canvas;
let gl;
let texture;

// https://github.com/webrtc/samples/blob/7ac95cac37f613ce5c68d92c90cfa27d9f3f0d18/src/content/insertable-streams/video-processing/js/webgl-transform.js
onmessage = async (event) => {
  const {operation} = event.data;
  console.log('[WebGL crop worker] message=' + operation);
  if (operation === 'init') {
    canvas = new OffscreenCanvas(1280, 720);
    gl = canvas.getContext('webgl2');
    if (!gl) {
      gl = canvas.getContext('webgl');
    }
    if (gl) {
      console.log('[WebGL crop worker] gl:', gl);
    }
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
  } else if (operation === 'crop') {
    const {readable, writable} = event.data;
    const source = readable.getReader();
    console.log('[WebGL crop worker] source:', source);
    
    try {
      while (true) {
        const { value: videoFrame, done: isStreamFinished } = await source.read();
        if (isStreamFinished) break;
        console.log('[WebGL crop worker] videoFrame:', videoFrame);
        
        // Upload image data in `videoFrame` to the `texture`.        
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, videoFrame);
        
        const newFrame = new VideoFrame(texture, {
          visibleRect: cropRect,
          displayWidth: 1280,
          displayHeight: 720,
        });
        
        await writable.write(newFrame);
        
        videoFrame.close();
      }
      source.releaseLock();
    } catch (e) {
      const message = `DOMException: ${e.name} [${e.message}]`; 
      console.error(message);
      postMessage({
        operation: 'exception',
        error: message,
      });
      cropRect = defaultVisibleRect;
    }
  } else if (operation === 'change') {
    cropRect = event.data.cropRect;
    console.log('[WebGL crop worker] visibleRect: ', cropRect);
  } else {
    console.error('[WebGL crop worker] Unknown operation', operation);
  }
};
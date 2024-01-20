'use strict';

const localVideo = document.getElementById('local');
const remoteVideo = document.getElementById('remote');
const gumButton = document.getElementById('gum');
const drawButton = document.getElementById('draw');
const captureButton = document.getElementById('capture');
const stopButton = document.getElementById('stop');
const canvas = document.querySelector('canvas');
const crop = document.getElementById('crop');
const qualitySelector = document.getElementById('quality');

drawButton.disabled = true;
captureButton.disabled = true;
stopButton.disabled = true;
crop.checked = true;

let stream;
let canvasStreamstream;
let context2d;
let canvasStream;
let intervalId;

const updateFps = 10;

// Crop and scale settings
const originLeft = 320;
const originTop = 240;
const scaledWidth = 320;
const scaledHeight = 240;

const vgaConstraints = {
  video: {width: {exact: 640}, height: {exact: 480}}
};

const hdConstraints = {
  video: {width: {exact: 1280}, height: {exact: 720}}
};

const prettyJson = (obj) => JSON.stringify(obj, null, 2);

const loge = (error) => {
  const errorElement = document.getElementById('error-message');
  errorElement.textContent = `DOMException: ${error.name} [${error.message}]`;
  console.error(error);
};

localVideo.addEventListener('loadedmetadata', function() {
  console.log(`Local video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
});

gumButton.onclick = async () => {
  try {
    const supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
    // console.log(prettyJson(supportedConstraints));
    stream = await navigator.mediaDevices.getUserMedia(vgaConstraints);
    const [videoTrack] = stream.getVideoTracks();
    console.log('Active constraints: ', videoTrack.getConstraints());
    localVideo.srcObject = stream;
    gumButton.disabled = true;
    stopButton.disabled = false;
    drawButton.disabled = false;
  } catch (e) {
    loge(e);
  }
};

drawButton.onclick = async () => {
  try {
    if (crop.checked) {
      console.log(`Crop and scale: {left=${originLeft}, top=${originTop}, scaledWidth=${scaledWidth}, scaledHeight=${scaledHeight}}`);
    }
    console.log(`Update rate: ${updateFps} fps`);
    context2d = canvas.getContext('2d');
    // This is expected to cause bilinear filtering to be used.
    console.log(`imageSmoothingQuality=${quality.value}`);
    context2d.imageSmoothingQuality = quality.value;
    canvas.width = localVideo.videoWidth;
    canvas.height = localVideo.videoHeight;
    intervalId = setInterval(() => {
      if (crop.checked) {
          // Cut out a section of the source image, then scale and draw it on our canvas.
          // https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Using_images#slicing
          context2d.drawImage(localVideo, originLeft, originTop, scaledWidth, scaledHeight, 0, 0, canvas.width, canvas.height);
      } else {
        context2d.drawImage(localVideo, 0, 0);
      }
      if (canvasStream) {
        const [track] = canvasStream.getVideoTracks();
        if (track) {
          // Send the current state of the canvas as a frame to the stream.
          track.requestFrame();
        }
      }
    }, 1000 / updateFps);
    drawButton.disabled = true;
    captureButton.disabled = false;
  } catch (e) {
    loge(e);
  }
};

crop.onchange = () => {
  if (crop.checked) {
    console.log(`Crop and scale: {left=${originLeft}, top=${originTop}, scaledWidth=${scaledWidth}, scaledHeight=${scaledHeight}}`);
  }
};

qualitySelector.onchange = () => {
  if (context2d) {
    console.log(`imageSmoothingQuality=${quality.value}`);
    context2d.imageSmoothingQuality = quality.value;
  }
};

captureButton.onclick = () => {
  if (context2d) {
    try {
      canvasStream = canvas.captureStream(0);
      remoteVideo.srcObject = canvasStream;
      console.log(canvasStream.getVideoTracks());
      captureButton.disabled = true;
    } catch (e) {
      loge(e);
    }
  }
};

stopButton.onclick = () => {
  if (intervalId) {
    clearInterval(intervalId);
  }
  if (stream) {
    for (const track of stream.getVideoTracks()) {
      track.stop();
    }
    stream = null;
  }
  if (context2d) {
    context2d.clearRect(0, 0, canvas.width, canvas.height);
  }
  if (canvasStream) {
    for (const track of canvasStream.getVideoTracks()) {
      track.stop();
    }
    canvasStream = null;
  }
  gumButton.disabled = false;
  drawButton.disabled = true;
  captureButton.disabled = true;
  stopButton.disabled = true;
};

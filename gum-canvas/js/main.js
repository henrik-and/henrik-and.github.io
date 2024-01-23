'use strict';

const localVideo = document.getElementById('local');
const gumButton = document.getElementById('gum');
const drawButton = document.getElementById('draw');
const captureButton = document.getElementById('capture');
const callButton = document.getElementById('call');
const stopButton = document.getElementById('stop');
const crop = document.getElementById('crop');
const qualitySelector = document.getElementById('quality');
const rateSelector = document.getElementById('rate');
const resolutionSelector = document.getElementById('resolution');

drawButton.disabled = true;
captureButton.disabled = true;
stopButton.disabled = true;
callButton.disabled = true;
crop.checked = false;
rateSelector.disabled = true;
qualitySelector.disabled = true;

drawButton.style.display = 'none';
captureButton.style.display = 'none';

let stream;
let canvasStream;
let context2d;
let intervalId;
let params;

let canvas;
let canvasVideo;

let pc1;
let pc2;

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
  console.log(`Local video offsetWidth: ${this.offsetWidth}px,  videoHeight: ${this.offsetHeight}px`);
});

function getCropAndScaleParameters() {
  if (resolution.value === 'VGA') {
    return {
      originLeft: 320,
      originTop: 240,
      scaledWidth: 320,
      scaledHeight: 240
    }
  } else {
    return {
      originLeft: 640,
      originTop: 360,
      scaledWidth: 640,
      scaledHeight: 360
    }
  }  
};

gumButton.onclick = async () => {
  try {
    const supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
    // console.log(prettyJson(supportedConstraints));
    let constraints = {};
    if (resolution.value === 'VGA') {
      constraints = vgaConstraints;
    } else {
      constraints = hdConstraints;
    }
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    const [videoTrack] = stream.getVideoTracks();
    console.log('Active constraints: ', videoTrack.getConstraints());
    console.log('videoTrack:', videoTrack);
    
    if (crop.checked) {
      console.log('Using path with canvas and extra video tag');
      canvasVideo = document.createElement('video');
      canvas = document.createElement('canvas');
      canvasVideo.srcObject = stream;
      canvasVideo.play();
      drawButton.disabled = false;
    } else {
      console.log('Using path without canvas and extra video tag');
      localVideo.srcObject = stream;
    }
    
    crop.disabled = true;
    gumButton.disabled = true;
    resolutionSelector.disabled = true;
    stopButton.disabled = false;
    callButton.disabled = false;
  } catch (e) {
    loge(e);
  }
};

function startCropAndScaleTimer() {
  intervalId = setInterval(() => {
    // Cut out a section of the source image, then scale and draw it on our canvas.
    // https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Using_images#slicing
    context2d.drawImage(canvasVideo, params.originLeft, params.originTop, params.scaledWidth, params.scaledHeight, 0, 0, canvas.width, canvas.height);
    // Pass through without cropping.
    // context2d.drawImage(canvasVideo, 0, 0);
    if (canvasStream) {
      const [track] = canvasStream.getVideoTracks();
      if (track) {
        // Send the current state of the canvas as a frame to the stream.
        track.requestFrame();
      }
    }
  }, 1000 / rate.value);
  return intervalId;
};

drawButton.onclick = async () => {
  try {
    params = getCropAndScaleParameters();
    console.log(`Crop and scale: {left=${params.originLeft}, top=${params.originTop}, scaledWidth=${params.scaledWidth}, scaledHeight=${params.scaledHeight}}`);
    console.log(`Update rate: ${rate.value} fps`);
    // canvas.style.opacity = 0;
    context2d = canvas.getContext('2d');
    // This is expected to cause bilinear filtering to be used.
    console.log(`imageSmoothingQuality=${quality.value}`);
    context2d.imageSmoothingQuality = quality.value;
    canvas.width = canvasVideo.videoWidth;
    canvas.height = canvasVideo.videoHeight;
    intervalId = startCropAndScaleTimer();
    drawButton.disabled = true;
    captureButton.disabled = false;
  } catch (e) {
    loge(e);
  }
};

crop.onchange = () => {
  if (crop.checked) {
    drawButton.style.display = 'inline-block';
    captureButton.style.display = 'inline-block';
    rateSelector.disabled = false;
    qualitySelector.disabled = false;
    params = getCropAndScaleParameters();
    console.log(`Crop and scale: {left=${params.originLeft}, top=${params.originTop}, scaledWidth=${params.scaledWidth}, scaledHeight=${params.scaledHeight}}`);
  } else {
    drawButton.style.display = 'none';
    captureButton.style.display = 'none';
    rateSelector.disabled = true;
    qualitySelector.disabled = true;
  }
};

rateSelector.onchange = () => {
  console.log(`Crop/Capture rate=${rate.value} fps`);
  if (context2d) {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = startCropAndScaleTimer();
    }
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
      localVideo.srcObject = canvasStream;
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
  closePeerConnection();
  crop.disabled = false;
  gumButton.disabled = false;
  resolutionSelector.disabled = false;
  drawButton.disabled = true;
  captureButton.disabled = true;
  callButton.disabled = true;
  stopButton.disabled = true;
};

callButton.onclick = async () => {
  await setupPeerConnection();
  callButton.disabled = true;
};

const setupPeerConnection = async () => {
  let activeStream;
  if (!crop.checked) {
    console.log('Using local stream from gUM');
    activeStream = stream;
  } else {
    console.log('Using canvas stream');
    activeStream = canvasStream;
  }
  console.log('activeStream:', activeStream); 
  pc1 = new RTCPeerConnection();
  pc2 = new RTCPeerConnection();
  const [localTrack] = activeStream.getVideoTracks();
  let remoteTrack = null;
  let remoteStream = null;
  pc1.addTrack(localTrack, activeStream);
  pc2.addTrack(localTrack, activeStream);
  pc2.ontrack = (e) => {
    remoteTrack = e.track;
    remoteStream = e.streams[0];
    // remoteVideo.srcObject = remoteStream;
  };
  exchangeIceCandidates(pc1, pc2);
  
  pc1.oniceconnectionstatechange = (e) => {
    console.log('pc1 ICE state: ' + pc1.iceConnectionState)
  }
  
  pc2.oniceconnectionstatechange = (e) => {
    console.log('pc2 ICE state: ' + pc2.iceConnectionState)
  }
  
  const offer = await pc1.createOffer();
  await pc1.setLocalDescription(offer);
  await pc2.setRemoteDescription(offer);
  console.log('pc1 offer: ', offer.sdp);
  
  const answer = await pc2.createAnswer();
  await pc2.setLocalDescription(answer);
  await pc1.setRemoteDescription(answer);
  console.log('pc2 answer: ', answer.sdp);
};

const closePeerConnection = () => {
  if (pc1) {
    pc1.close();
    pc1 = null;
  }
  if (pc2) {
    // remoteVideo.srcObject = null;
    pc2.close();
    pc2 = null;
  }
};

const exchangeIceCandidates = (pc1, pc2) => {
  function doExchange(localPc, remotePc) {
    localPc.addEventListener('icecandidate', event => {
      const { candidate } = event;
      if (candidate && remotePc.signalingState !== 'closed') {
        remotePc.addIceCandidate(candidate);
      }
    });
  }
  doExchange(pc1, pc2);
  doExchange(pc2, pc1);
};

'use strict';

if (typeof MediaStreamTrackProcessor === 'undefined' ||
    typeof MediaStreamTrackGenerator === 'undefined') {
  alert(
      'Your browser does not support the experimental MediaStreamTrack API ');
}

const localVideo = document.getElementById('local');
const encodedVideo = document.getElementById('encoded');
const gumButton = document.getElementById('gum');
const callButton = document.getElementById('call');
const stopButton = document.getElementById('stop');
const cropMethod = document.getElementById('crop');
const resolutionSelector = document.getElementById('resolution');
const statsDiv = document.getElementById('stats');
const renderCheckbox = document.getElementById('renderEncoded');

stopButton.disabled = true;
callButton.disabled = true;

let stream;
let remoteStream;
let canvasStream;
let context2d;
let intervalId;
let trackStatsIntervalId;
let params;

let canvas;
let canvasVideo;

let worker;
let processor;
let generator;

let pc1;
let pc2;

let activeSourceStream;

const rateFps = 30;

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
    
    await activateSelectedCropMethod();
       
    gumButton.disabled = true;
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
  }, 1000 / rateFps);
  return intervalId;
};

renderCheckbox.onchange = () => {
  if (renderEncoded.checked) {
  } else {
    if (encodedVideo.srcObject) {
      encodedVideo.pause();
      encodedVideo.srcObject = null;
    }
  }
};

crop.onchange = async () => {
  await activateSelectedCropMethod();
};

const activateSelectedCropMethod = async () => {
  console.log('Selected crop method is: ' + crop.value);
  await clearActiveCropping();
  
  if (crop.value === 'none') {
    activateNone();
  } else if (crop.value === 'canvas') {
    await activateCanvas();
  } else if (crop.value === 'visibleRect') {
    activateVisibleRect();
  } else {
    console.log('[ERROR] Invalid selection');
  }
  
  if (activeSourceStream) {
    console.log('Restarting peerconnection using latest source...'); 
    closePeerConnection();
    await setupPeerConnection();
  }
};

const activateNone = () => {
  console.log('activateNone');
  if (!stream) {
    return;
  }
  localVideo.srcObject = stream;
};

const activateCanvas = async () => {
  console.log('activateCanvas');
  if (!stream) {
    console.log('No MediaStreamTrack exists yet');
    return;
  }
  try {
    canvasVideo = document.createElement('video');
    canvas = document.createElement('canvas');
    canvasVideo.srcObject = stream;
    canvasVideo.play();
    
    let resolvePromise;
    const promise = new Promise(r => resolvePromise = r);
    
    // TODO(henrika): do we need removeEventListener?
    canvasVideo.addEventListener('loadedmetadata', function() {
      // The duration and dimensions of the media tracks are now known.
      console.log(`Canvas video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
      console.log(`Canvas video offsetWidth: ${this.offsetWidth}px,  videoHeight: ${this.offsetHeight}px`);      
      try {
        params = getCropAndScaleParameters();
        console.log(`Crop and scale: {left=${params.originLeft}, top=${params.originTop}, scaledWidth=${params.scaledWidth}, scaledHeight=${params.scaledHeight}}`);
        context2d = canvas.getContext('2d');
        context2d.imageSmoothingQuality = 'medium';
        canvas.width = canvasVideo.videoWidth;
        canvas.height = canvasVideo.videoHeight;
        console.log(`Canvas: width=${canvas.width}, height=${canvas.height}`);
      
        canvasStream = canvas.captureStream(0);
        localVideo.srcObject = canvasStream;
        console.log(canvasStream.getVideoTracks());
      
        intervalId = startCropAndScaleTimer();
        resolvePromise();
      } catch (e) {
        log(e);
      }
    });
    
    await promise;
  } catch (e) {
    loge(e);
  }  
};

const activateVisibleRect = () => {
  console.log('activateVisibleRect');
  if (!stream) {
    console.log('No MediaStreamTrack exists yet');
    return;
  }
  if (worker) {
    console.log('[ERROR] worker is still active');
    return;
  }
  worker = new Worker('./js/worker.js', {name: 'Crop worker'});
  
  const [track] = stream.getVideoTracks();
  processor = new MediaStreamTrackProcessor({track});
  const {readable} = processor;

  // Creates a WritableStream that acts as a MediaStreamTrack source.
  // The object consumes a stream of video frames as input.
  generator = new MediaStreamTrackGenerator({kind: 'video'});
  const {writable} = generator;
  localVideo.srcObject = new MediaStream([generator]);

  worker.postMessage({
    operation: 'crop',
    readable,
    writable,
  }, [readable, writable]);
  
};

const clearActiveCropping = async () => {
  console.log('clearActiveCropping');
  try {
    if (intervalId) {
      clearInterval(intervalId);
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
    if (worker) {
      processor.readable.cancel();
      worker.terminate();
      processor = null;
      generator = null;
      worker = null;
    }
  } catch (e) {
    loge(e);
  }
}  

stopButton.onclick = async () => {
  await clearActiveCropping();
  if (trackStatsIntervalId) {
    clearInterval(trackStatsIntervalId);
  }
  if (stream) {
    for (const track of stream.getVideoTracks()) {
      track.stop();
    }
    stream = null;
  }
  if (remoteStream) {
    for (const track of remoteStream.getVideoTracks()) {
      track.stop();
    }
    remoteStream = null;
  }
  if (localVideo.srcObject) {
    localVideo.srcObject = null;
  }
  if (encodedVideo.srcObject) {
    encodedVideo.srcObject = null;
  }
  statsDiv.textContent = "";
  closePeerConnection();
  gumButton.disabled = false;
  callButton.disabled = true;
  stopButton.disabled = true;
  renderCheckbox.disabled = false;
};

callButton.onclick = async () => {
  try {
    await setupPeerConnection();
    callButton.disabled = true;
    renderCheckbox.disabled = true;

    // https://w3c.github.io/webrtc-stats/#outboundrtpstats-dict*
    trackStatsIntervalId = setInterval(async () => {
      if (pc1) {
        const report = await pc1.getStats();
        for (const stats of report.values()) {
          if (stats.type === 'outbound-rtp') {
            const partialStats = {};
            partialStats.contentType = stats.contentType;
            partialStats.frameWidth = stats.frameWidth;
            partialStats.frameHeight = stats.frameHeight;
            const mimeType = report.get(stats.codecId).mimeType;
            partialStats.codec = mimeType.split('/')[1];
            partialStats.encoderImplementation = stats.encoderImplementation;
            partialStats.powerEfficientEncoder = stats.powerEfficientEncoder;
            partialStats.scalabilityMode= stats.scalabilityMode;
            partialStats.framesPerSecond = stats.framesPerSecond;
            statsDiv.textContent = `${stats.type}:\n` + prettyJson(partialStats);
          }
        }
      }
    }, 1000);
  } catch (e) {
    loge(e);
  }
};

const setupPeerConnection = async () => {
  console.log('setupPeerConnection');
  if (canvasStream) {
    console.log('Using canvas stream as source to PC');
  } else if (worker) {
    console.log('Using breakout-box stream as source to PC');
  } else {
    console.log('Using local stream from gUM as source to PC');
  }
  activeSourceStream = localVideo.srcObject;
  console.log('activeSourceStream:', activeSourceStream);
  
  pc1 = new RTCPeerConnection();
  pc2 = new RTCPeerConnection();
  const [localTrack] = activeSourceStream.getVideoTracks();
  let remoteTrack = null;
  const sender = pc1.addTrack(localTrack, activeSourceStream);
  const parameters = sender.getParameters();
  parameters.encodings[0].scalabiltyMode = 'L1T1';
  await sender.setParameters(parameters);
  pc2.ontrack = (e) => {
    remoteTrack = e.track;
    remoteStream = e.streams[0];
    if (renderEncoded.checked) {
      encodedVideo.srcObject = remoteStream;
    }
  };
  exchangeIceCandidates(pc1, pc2);
  
  pc1.oniceconnectionstatechange = (e) => {
    console.log('pc1 ICE state: ' + pc1.iceConnectionState)
  }
  
  pc2.oniceconnectionstatechange = (e) => {
    console.log('pc2 ICE state: ' + pc2.iceConnectionState)
  }
  
  // TODO(henrika): We should also include all of the following, otherwise we'd
  // turn off features like RTX etc:
  // mimeType == 'video/ulpfec' || mimeType == 'video/red' || mimeType == 'video/rtx'.
  // See https://jsfiddle.net/henbos/c2zqb1yw/.
  const transceiver = pc1.getTransceivers()[0];
  if (transceiver.setCodecPreferences) {
    const codecs = RTCRtpSender.getCapabilities('video').codecs.filter(
      (c) => c.mimeType.includes('VP9'),
    );
    transceiver.setCodecPreferences(codecs);
  }
  
  const offer = await pc1.createOffer();
  await pc1.setLocalDescription(offer);
  await pc2.setRemoteDescription(offer);
  // console.log('pc1 offer: ', offer.sdp);
  
  const answer = await pc2.createAnswer();
  await pc2.setLocalDescription(answer);
  await pc1.setRemoteDescription(answer);
  // console.log('pc2 answer: ', answer.sdp);
  
  // TODO(henrika): improve logs for active connection.
};

const closePeerConnection = () => {
  console.log('closePeerConnection');
  if (pc1) {
    pc1.close();
    pc1 = null;
  }
  if (pc2) {
    // remoteVideo.srcObject = null;
    pc2.close();
    pc2 = null;
  }
  activeSourceStream = null;
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

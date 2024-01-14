// Based on https://jsfiddle.net/henbos/m08wjqtk/ and
// https://jsfiddle.net/5ve4gbjx/3/.

'use strict';

let stream;
let pc1 = null;
let pc2 = null;

const localVideo = document.getElementById('local');
const remoteVideo = document.getElementById('remote');

const startButton = document.getElementById('start');
const callButton = document.getElementById('call');
const hangupButton = document.getElementById('hangup');
const resetDelayStatsButton = document.getElementById('reset');
const applyConstraintsButton = document.getElementById('applyConstraints');

callButton.disabled = true;
hangupButton.disabled = true;
resetDelayStatsButton.disabled = true;
applyConstraintsButton.disabled = true;


localVideo.addEventListener('loadedmetadata', function() {
  console.log(`Local video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
});

remoteVideo.addEventListener('loadedmetadata', function() {
  console.log(`Remote video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
});

const prettyJson = (obj) => JSON.stringify(obj, null, 2);

const loge = (error) => {
  const errorElement = document.getElementById('error-message');
  errorElement.textContent = `DOMException: ${error.name} [${error.message}]`;
  console.error(error);
};

// Note: min and exact values are not permitted in constraints used in MediaDevices.getDisplayMedia()
// calls — they produce a TypeError — but they are allowed in constraints used in
// MediaStreamTrack.applyConstraints() calls.
// See https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints#constraindouble.
function getDisplayMediaOptions() {
  const mediaTrackConstraints = {};
  // Use the max framerate as ideal frame rate for the gDM options.
  // Max and min framerates will be set using applyConstraints() later on.
  if (applyFrameRateMax.value !== 'default') {
    mediaTrackConstraints.frameRate = {ideal: applyFrameRateMax.value};
  }
  return {video: mediaTrackConstraints};
};

function getDisplayMediaConstraints() {
  let constraints = {};
  
  if (applyHeight.value !== 'default') {
    constraints.height = applyHeight.value;
  }
  if (applyWidth.value !== 'default') {
    constraints.width = applyWidth.value;
  }
  if (applyFrameRateMin.value !== 'default' && applyFrameRateMax.value == 'default') {
    constraints.frameRate = {min: applyFrameRateMin.value};
  }
  if (applyFrameRateMin.value == 'default' && applyFrameRateMax.value !== 'default') {
    constraints.frameRate = {max: applyFrameRateMax.value};
  }
  if (applyFrameRateMin.value !== 'default' && applyFrameRateMax.value !== 'default') {
    constraints.frameRate = {min: applyFrameRateMin.value, max: applyFrameRateMax.value};
  }
  return constraints;
};

startButton.onclick = async () => { 
  try {
    if (stream) {
      for (const track of stream.getVideoTracks()) {
        track.stop();
      }
      stream = null;
    }
    if (!stream) {
      // Use options to gDM but avoid using min framerate.
      const options = getDisplayMediaOptions();
      console.log('getDisplayMedia options=', prettyJson(options));
      
      stream = await navigator.mediaDevices.getDisplayMedia(options);
      const [localTrack] = stream.getTracks();
      console.log(localTrack);
      localVideo.srcObject = stream;
      
      // Triggers when the user has stopped sharing the screen via the browser UI.
      localTrack.addEventListener('ended', () => {
        startButton.disabled = false;
        callButton.disabled = true;
      });
      
      startButton.disabled = true;
      callButton.disabled = false;
      applyConstraintsButton.disabled = false;
    }
  } catch (e) {
    loge(e);
  }
};

applyConstraintsButton.onclick = async () => {
  // resetDelayStats();
  if (stream) {
    const constraints = getDisplayMediaConstraints();
    console.log('Requested constraints:', prettyJson(constraints));
    const [track] = stream.getVideoTracks();
    await track.applyConstraints(constraints);
    const actualConstraints = track.getConstraints();
    console.log('Actual constraints:', prettyJson(actualConstraints));
  }
};

callButton.onclick = async () => {
  
  await setupPeerConnection();
  
  callButton.disabled = true;
  hangupButton.disabled = false;
  resetDelayStatsButton.disabled = false;
  
  // codecSelector.disabled = true;
  // startTime = window.performance.now();
};

hangupButton.onclick = () => {
  closePeerConnection();
  hangupButton.disabled = true;
  callButton.disabled = false;
  applyConstraintsButton.disabled = true;
  resetDelayStatsButton.disabled = true;
  // codecSelector.disabled = false;
};

const setupPeerConnection = async () => {
  if (!stream) {
    return;
  }
  pc1 = new RTCPeerConnection();
  pc2 = new RTCPeerConnection();
  const [localTrack] = stream.getVideoTracks();
  let remoteTrack = null;
  let remoteStream = null;
  pc1.addTrack(localTrack, stream);
  pc2.addTrack(localTrack, stream);
  pc2.ontrack = (e) => {
    remoteTrack = e.track;
    remoteStream = e.streams[0];
    remoteVideo.srcObject = remoteStream;
  };
  exchangeIceCandidates(pc1, pc2);
  const offer = await pc1.createOffer();
  await pc1.setLocalDescription(offer);
  await pc2.setRemoteDescription(offer);
  const answer = await pc2.createAnswer();
  await pc2.setLocalDescription(answer);
  await pc1.setRemoteDescription(answer);
  await new Promise(resolve => setTimeout(resolve, 1000));
};

const closePeerConnection = () => {
  if (pc1) {
    pc1.close();
    pc1 = null;
  }
  if (pc2) {
    remoteVideo.srcObject = null;
    pc2.close();
    pc2 = null;
  }
};

function exchangeIceCandidates(pc1, pc2) {
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
}

/*
(async () => {
  pc1 = new RTCPeerConnection();
  pc2 = new RTCPeerConnection();
  const stream = await navigator.mediaDevices.getUserMedia({video:true});
  const [localTrack] = stream.getTracks();

  localVideo.srcObject = stream;

  let remoteTrack = null;
  let remoteStream = null;
  pc1.addTrack(localTrack, stream);
  pc2.addTrack(localTrack, stream);
  pc2.ontrack = e => {
    remoteTrack = e.track;
    remoteStream = e.streams[0];
    remoteVideo.srcObject = remoteStream;
  };
  exchangeIceCandidates(pc1, pc2);
  const offer = await pc1.createOffer();
  await pc1.setLocalDescription(offer);
  await pc2.setRemoteDescription(offer);
  const answer = await pc2.createAnswer();
  await pc2.setLocalDescription(answer);
  await pc1.setRemoteDescription(answer);
  await new Promise(resolve => setTimeout(resolve, 1000));
})();

async function doGetStats() {
  const report = await pc1.getStats();
  console.log(report);
  for (let stats of report.values()) {
    console.log(stats.type);
    console.log('  id: ' + stats.id);
    console.log('  timestamp: ' + stats.timestamp);
    Object.keys(stats).forEach(key => {
      if (key != 'type' && key != 'id' && key != 'timestamp')
        console.log('  ' + key + ': ' + stats[key]);
    });
  }
}

function exchangeIceCandidates(pc1, pc2) {
  function doExchange(localPc, remotePc) {
    localPc.addEventListener('icecandidate', event => {
      const { candidate } = event;
      if(candidate && remotePc.signalingState !== 'closed') {
        remotePc.addIceCandidate(candidate);
      }
    });
  }
  doExchange(pc1, pc2);
  doExchange(pc2, pc1);
}
*/


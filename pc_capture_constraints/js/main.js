/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

'use strict';

const startButton = document.getElementById('startButton');
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangupButton');
callButton.disabled = true;
hangupButton.disabled = true;
startButton.addEventListener('click', start);
callButton.addEventListener('click', call);
hangupButton.addEventListener('click', hangup);

const minFramerateInput = document.querySelector('div#minFramerate input');
const maxFramerateInput = document.querySelector('div#maxFramerate input');

minFramerateInput.onchange = maxFramerateInput.onchange = displayRangeValue;

const getDisplayMediaConstraintsDiv = document.querySelector('div#getDisplayMediaConstraints');

let startTime;
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

const senderStatsDiv = document.querySelector('div#senderStats');
const receiverStatsDiv = document.querySelector('div#receiverStats');
const updateStats = document.querySelector('input#updateStats');

function main() {
  showGetDisplayMediaConstraints();
}

localVideo.addEventListener('loadedmetadata', function() {
  console.log(`Local video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
});

remoteVideo.addEventListener('loadedmetadata', function() {
  console.log(`Remote video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
});

const prettyJson = (obj) => JSON.stringify(obj, null, 2);

remoteVideo.addEventListener('resize', () => {
  console.log(`Remote video size changed to ${remoteVideo.videoWidth}x${remoteVideo.videoHeight} - Time since pageload ${performance.now().toFixed(0)}ms`);
  // We'll use the first onsize callback as an indication that video has started
  // playing out.
  if (startTime) {
    const elapsedTime = window.performance.now() - startTime;
    console.log('Setup time: ' + elapsedTime.toFixed(3) + 'ms');
    startTime = null;
  }
});

function getDisplayMediaOptions() {
  const constraints = {};
  constraints.audio = false;
  constraints.video = {};
  if (maxFramerateInput.value !== '0') {
    constraints.video.frameRate = constraints.video.frameRate || {};
    constraints.video.frameRate.max = maxFramerateInput.value;
  }

  return constraints;
}

function getDisplayMediaConstraints() {
  const constraints = {};
  constraints.audio = false;
  constraints.video = {};
  if (minFramerateInput.value !== '0') {
    constraints.video.frameRate = {};
    constraints.video.frameRate.min = minFramerateInput.value;
  }
  if (maxFramerateInput.value !== '0') {
    constraints.video.frameRate = constraints.video.frameRate || {};
    constraints.video.frameRate.max = maxFramerateInput.value;
  }

  return constraints;
}

function showGetDisplayMediaConstraints() {
  const constraints = getDisplayMediaConstraints();
  // console.log('getDisplayMedia constraints', constraints);
  getDisplayMediaConstraintsDiv.textContent = prettyJson(constraints);
}

// Utility to show the value of a range in a sibling span element
function displayRangeValue(e) {
  const span = e.target.parentElement.querySelector('span');
  span.textContent = e.target.value;
  showGetDisplayMediaConstraints();
}

let localStream;
let pc1;
let pc2;
const offerOptions = {
  offerToReceiveAudio: 1,
  offerToReceiveVideo: 1
};

function getName(pc) {
  return (pc === pc1) ? 'pc1' : 'pc2';
}

function getOtherPc(pc) {
  return (pc === pc1) ? pc2 : pc1;
}

async function start() {
  console.log('Requesting local stream');
  startButton.disabled = true;
 
  // Use options to gDM but avoid using min framerate.
  navigator.mediaDevices.getDisplayMedia(getDisplayMediaOptions())
    .then(handleSuccess, handleError);
}

function handleSuccess(stream) {
  startButton.disabled = true;
  
  const videoTrack = stream.getVideoTracks()[0]; 
  const constraints = getDisplayMediaConstraints();
  console.log('Requested contstraints', prettyJson(constraints));
  
  // Apply the complete constraint (including possibly >0 min framerate).
  videoTrack
    .applyConstraints(constraints)
    .then(() => {
      console.log('getDisplayMedia.getSettings', prettyJson(videoTrack.getSettings()));
    })
    .catch(handleError);
  
  localVideo.srcObject = stream;
  localStream = stream;
  callButton.disabled = false;

  // Demonstrates how to detect that the user has stopped
  // sharing the screen via the browser UI.
  videoTrack.addEventListener('ended', () => {
    errorMsg('The user has ended sharing the screen');
    startButton.disabled = false;
  });
}

function handleError(error) {
  errorMsg(`getDisplayMedia error: ${error.name}`, error);
}

function errorMsg(msg, error) {
  console.log(msg);
  if (typeof error !== 'undefined') {
    console.error(error);
  }
}

async function call() {
  callButton.disabled = true;
  hangupButton.disabled = false;
  console.log('Starting call');
  startTime = window.performance.now();
  const videoTracks = localStream.getVideoTracks();
  const audioTracks = localStream.getAudioTracks();
  if (videoTracks.length > 0) {
    console.log(`Using video device: ${videoTracks[0].label}`);
  }
  if (audioTracks.length > 0) {
    console.log(`Using audio device: ${audioTracks[0].label}`);
  }
  const configuration = {};
  console.log('RTCPeerConnection configuration:', configuration);
  pc1 = new RTCPeerConnection(configuration);
  console.log('Created local peer connection object pc1');
  pc1.addEventListener('icecandidate', e => onIceCandidate(pc1, e));
  pc2 = new RTCPeerConnection(configuration);
  console.log('Created remote peer connection object pc2');
  pc2.addEventListener('icecandidate', e => onIceCandidate(pc2, e));
  pc1.addEventListener('iceconnectionstatechange', e => onIceStateChange(pc1, e));
  pc2.addEventListener('iceconnectionstatechange', e => onIceStateChange(pc2, e));
  pc2.addEventListener('track', gotRemoteStream);

  localStream.getTracks().forEach(track => pc1.addTrack(track, localStream));
  console.log('Added local stream to pc1');

  try {
    console.log('pc1 createOffer start');
    const offer = await pc1.createOffer(offerOptions);
    await onCreateOfferSuccess(offer);
  } catch (e) {
    onCreateSessionDescriptionError(e);
  }
}

function onCreateSessionDescriptionError(error) {
  console.log(`Failed to create session description: ${error.toString()}`);
}

async function onCreateOfferSuccess(desc) {
  console.log(`Offer from pc1\n${desc.sdp}`);
  console.log('pc1 setLocalDescription start');
  try {
    await pc1.setLocalDescription(desc);
    onSetLocalSuccess(pc1);
  } catch (e) {
    onSetSessionDescriptionError();
  }

  console.log('pc2 setRemoteDescription start');
  try {
    await pc2.setRemoteDescription(desc);
    onSetRemoteSuccess(pc2);
  } catch (e) {
    onSetSessionDescriptionError();
  }

  console.log('pc2 createAnswer start');
  // Since the 'remote' side has no media stream we need
  // to pass in the right constraints in order for it to
  // accept the incoming offer of audio and video.
  try {
    const answer = await pc2.createAnswer();
    await onCreateAnswerSuccess(answer);
  } catch (e) {
    onCreateSessionDescriptionError(e);
  }
}

function onSetLocalSuccess(pc) {
  console.log(`${getName(pc)} setLocalDescription complete`);
}

function onSetRemoteSuccess(pc) {
  console.log(`${getName(pc)} setRemoteDescription complete`);
}

function onSetSessionDescriptionError(error) {
  console.log(`Failed to set session description: ${error.toString()}`);
}

function gotRemoteStream(e) {
  if (remoteVideo.srcObject !== e.streams[0]) {
    remoteVideo.srcObject = e.streams[0];
    console.log('pc2 received remote stream');
  }
}

async function onCreateAnswerSuccess(desc) {
  console.log(`Answer from pc2:\n${desc.sdp}`);
  console.log('pc2 setLocalDescription start');
  try {
    await pc2.setLocalDescription(desc);
    onSetLocalSuccess(pc2);
  } catch (e) {
    onSetSessionDescriptionError(e);
  }
  console.log('pc1 setRemoteDescription start');
  try {
    await pc1.setRemoteDescription(desc);
    onSetRemoteSuccess(pc1);
  } catch (e) {
    onSetSessionDescriptionError(e);
  }
}

async function onIceCandidate(pc, event) {
  try {
    await (getOtherPc(pc).addIceCandidate(event.candidate));
    onAddIceCandidateSuccess(pc);
  } catch (e) {
    onAddIceCandidateError(pc, e);
  }
  console.log(`${getName(pc)} ICE candidate:\n${event.candidate ? event.candidate.candidate : '(null)'}`);
}

function onAddIceCandidateSuccess(pc) {
  console.log(`${getName(pc)} addIceCandidate success`);
}

function onAddIceCandidateError(pc, error) {
  console.log(`${getName(pc)} failed to add ICE Candidate: ${error.toString()}`);
}

function onIceStateChange(pc, event) {
  if (pc) {
    console.log(`${getName(pc)} ICE state: ${pc.iceConnectionState}`);
    console.log('ICE state change event: ', event);
  }
}

function hangup() {
  console.log('Ending call');
  pc1.close();
  pc2.close();
  pc1 = null;
  pc2 = null;
  hangupButton.disabled = true;
  callButton.disabled = false;
}

function showLocalStats(results) {
  results.forEach(report => {
    if (report.type === 'outbound-rtp') {
      const framesPerSecond = report.framesPerSecond;
      if (framesPerSecond) {
        senderStatsDiv.innerHTML = `<strong>outbound-rtp framesPerSecond:</strong> ${framesPerSecond}`;
      }
    }
  });
}

function showRemoteStats(results) {
  results.forEach(report => {
    if (report.type === 'inbound-rtp') {
      const framesPerSecond = report.framesPerSecond;
      if (framesPerSecond) {
        receiverStatsDiv.innerHTML = `<strong>inbound-rtp framesPerSecond:</strong> ${framesPerSecond}`;
      }
    }
  });
}

// Display statistics
setInterval(() => {
  if (!updateStats.checked) {
    return;
  }
  if (pc1 && pc2) {
    pc1
        .getStats(null)
        .then(showLocalStats, err => console.log(err));
    pc2
        .getStats(null)
        .then(showRemoteStats, err => console.log(err));
  } else {
    // console.log('Not connected yet');
  }
}, 1000);

main();

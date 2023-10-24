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
const getActualDisplayMediaConstraintsDiv = document.querySelector('div#getActualDisplayMediaConstraints');

let startTime;

const localVideo = document.querySelector('div#localVideo video');
const remoteVideo = document.querySelector('div#remoteVideo video');
const localVideoSizeDiv = document.querySelector('div#localVideo div');
const remoteVideoSizeDiv = document.querySelector('div#remoteVideo div');

const localVideoFpsDiv = document.querySelector('div#localVideoFramerate');
const remoteVideoFpsDiv = document.querySelector('div#remoteVideoFramerate');

const localTrackStatsDiv = document.querySelector('div#localTrackStats');
const mediaSourceStatsDiv = document.querySelector('div#mediaSourceStats');
const senderStatsDiv = document.querySelector('div#senderStats');
const receiverStatsDiv = document.querySelector('div#receiverStats');
const updateStats = document.querySelector('input#updateStats');

let oldTimestampMs = 0;
let oldLocalFrames = 0;
let localFps = 30;
let oldRemoteFrames = 0;
let remoteFps = 30;

function main() {
  setTimeout(updateVideoFps, 30);
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
  return {video: { frameRate: maxFramerateInput.value}};
}

function getDisplayMediaConstraints() {
 return {frameRate: {min: minFramerateInput.value, max: maxFramerateInput.value}};
}

function showGetDisplayMediaConstraints() {
  const constraints = getDisplayMediaConstraints();
  // console.log('getDisplayMedia constraints', constraints);
  getDisplayMediaConstraintsDiv.textContent = 'Requested constraints:\n' + prettyJson(constraints);
}

// Utility to show the value of a range in a sibling span element
function displayRangeValue(e) {
  const span = e.target.parentElement.querySelector('span');
  span.textContent = e.target.value;
  showGetDisplayMediaConstraints();
}

let localStream;
let localPeerConnection;
let remotePeerConnection;
let prevStats = null;
let prevOutStats = null;
let prevInStats = null;

function getName(pc) {
  return (pc === localPeerConnection) ? 'localPeerConnection' : 'remotePeerConnection';
}

function getOtherPc(pc) {
  return (pc === localPeerConnection) ? remotePeerConnection : localPeerConnection;
}

async function start() {
  console.log('Requesting local stream');
  startButton.disabled = true;
  
  // Use options to gDM but avoid using min framerate.
  const options = getDisplayMediaOptions();
  console.log(options);
  navigator.mediaDevices.getDisplayMedia(options)
    .then(handleSuccess, handleError);
}

function handleSuccess(stream) {
  startButton.disabled = true;
  
  const videoTrack = stream.getVideoTracks()[0]; 
  const constraints = getDisplayMediaConstraints();
  console.log('Requested constraints', prettyJson(constraints));
  
  // Apply the complete constraint (including possibly >0 min framerate).
  videoTrack
    .applyConstraints(constraints)
    .then(() => {
      const settings = videoTrack.getSettings();
      console.log('getDisplayMedia.getSettings', prettyJson(settings));
      // getActualDisplayMediaConstraintsDiv.textContent = 'Actual constraints:\n' + prettyJson(settings);
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
  localPeerConnection = new RTCPeerConnection(configuration);
  console.log('Created local peer connection object localPeerConnection');
  localPeerConnection.addEventListener('icecandidate', e => onIceCandidate(localPeerConnection, e));
  remotePeerConnection = new RTCPeerConnection(configuration);
  console.log('Created remote peer connection object remotePeerConnection');
  remotePeerConnection.addEventListener('icecandidate', e => onIceCandidate(remotePeerConnection, e));
  localPeerConnection.addEventListener('iceconnectionstatechange', e => onIceStateChange(localPeerConnection, e));
  remotePeerConnection.addEventListener('iceconnectionstatechange', e => onIceStateChange(remotePeerConnection, e));
  remotePeerConnection.addEventListener('track', gotRemoteStream);

  localStream.getTracks().forEach(track => localPeerConnection.addTrack(track, localStream));
  console.log('Added local stream to localPeerConnection');

  try {
    console.log('localPeerConnection createOffer start');
    const offer = await localPeerConnection.createOffer();
    await onCreateOfferSuccess(offer);
  } catch (e) {
    onCreateSessionDescriptionError(e);
  }
}

function onCreateSessionDescriptionError(error) {
  console.log(`Failed to create session description: ${error.toString()}`);
}

async function onCreateOfferSuccess(desc) { 
  console.log('localPeerConnection setLocalDescription start');
  desc.sdp = insertReceiverReferenceTimeReport(desc.sdp);
  console.log(`Modified offer from localPeerConnection\n${desc.sdp}`)
  
  try {
    await localPeerConnection.setLocalDescription(desc);
    onSetLocalSuccess(localPeerConnection);
  } catch (e) {
    onSetSessionDescriptionError();
  }
  console.log('remotePeerConnection setRemoteDescription start');
  try {
    await remotePeerConnection.setRemoteDescription(desc);
    onSetRemoteSuccess(remotePeerConnection);
  } catch (e) {
    onSetSessionDescriptionError();
  }

  console.log('remotePeerConnection createAnswer start');
  // Since the 'remote' side has no media stream we need
  // to pass in the right constraints in order for it to
  // accept the incoming offer of audio and video.
  try {
    const answer = await remotePeerConnection.createAnswer();
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
    console.log('remotePeerConnection received remote stream');
  }
}

const insertReceiverReferenceTimeReport = (sdp) => {
  var lines = sdp.split('\r\n');
  var newSdp = [];
  for(var i = 0; i < lines.length; i++) {
    newSdp.push(lines[i])
    var match = lines[i].match(/([0-9]+) nack pli/);
    if (match) {
      newSdp.push('a=rtcp-fb:' + match[1] + ' rrtr'); 
    }
  }
  return newSdp.join('\r\n');
}

async function onCreateAnswerSuccess(desc) {
  desc.sdp = insertReceiverReferenceTimeReport(desc.sdp);
  console.log(`Modified offer from remotePeerConnection\n${desc.sdp}`)
  console.log('remotePeerConnection setLocalDescription start');
  try {
    await remotePeerConnection.setLocalDescription(desc);
    onSetLocalSuccess(remotePeerConnection);
  } catch (e) {
    onSetSessionDescriptionError(e);
  }
  console.log('localPeerConnection setRemoteDescription start');
  try {
    await localPeerConnection.setRemoteDescription(desc);
    onSetRemoteSuccess(localPeerConnection);
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
  localPeerConnection.close();
  remotePeerConnection.close();
  localPeerConnection = null; 
  remotePeerConnection = null;
  hangupButton.disabled = true;
  callButton.disabled = false;
}

/*
{
  "id": "OT01V2112872935"
  "timestamp": 1697724536805.958,
  "type": "outbound-rtp",
  "codecId": "COT01_96",
  "kind": "video",
  "mediaType": "video",
  "ssrc": 2112872935,
  "transportId": "T01",
  "bytesSent": 12303816,
  "packetsSent": 11961,
  "active": true,
  "contentType": "screenshare",
  "encoderImplementation": "libvpx",
  "firCount": 0,
  "frameHeight": 2160,
  "frameWidth": 3840,
  "framesEncoded": 1949,
  "framesPerSecond": 21,
  "framesSent": 1949,
  "headerBytesSent": 303189,
  "hugeFramesSent": 6,
  "keyFramesEncoded": 1,
  "mediaSourceId": "SV3",
  "mid": "0",
  "nackCount": 0,
  "pliCount": 0,
  "powerEfficientEncoder": false,
  "qpSum": 50481,
  "qualityLimitationDurations": {
    "bandwidth": 0,
    "cpu": 0,
    "none": 89.696,
    "other": 0
  },
  "qualityLimitationReason": "none",
  "qualityLimitationResolutionChanges": 0,
  "remoteId": "RIV2112872935",
  "retransmittedBytesSent": 0,
  "retransmittedPacketsSent": 0,
  "rtxSsrc": 2925010918,
  "scalabilityMode": "L1T1",
  "targetBitrate": 2500000,
  "totalEncodeTime": 34.463,
  "totalEncodedBytesTarget": 0,
  "totalPacketSendDelay": 40.278261
}
*/

/*
media-source: {
  "id": "SV6",
  "timestamp": 1697815077957.937,
  "type": "media-source",
  "kind": "video",
  "trackIdentifier": "df594376-7266-4a6b-bf2b-7d56f9b9c9f4",
  "frames": 1129,
  "framesPerSecond": 29,
  "height": 1440,
  "width": 2560
}
*/

function showLocalStats(results) {
  results.forEach(report => {
    const partialStats = {};
    if (report.type === 'media-source') {
      partialStats.frames = report.frames;
      // The number of encoded frames during the last second.
      partialStats.encodedFramesPerSecond = report.framesPerSecond;
      partialStats.height = report.height;
      partialStats.width = report.width;
      mediaSourceStatsDiv.textContent = `${report.type}:\n` + prettyJson(partialStats);
    } else if (report.type === 'outbound-rtp') {
      // https://w3c.github.io/webrtc-stats/#outboundrtpstats-dict*
      const currOutStats = report;
      // partialStats.contentType = currOutStats.contentType;
      partialStats.encoderImplementation = currOutStats.encoderImplementation;
      // partialStats.powerEfficientEncoder = currOutStats.powerEfficientEncoder;
      partialStats.framesSent = currOutStats.framesSent;
      partialStats.framesPerSecond = currOutStats.framesPerSecond;
      partialStats.framesEncoded = currOutStats.framesEncoded;
      partialStats.qualityLimitationDurations = currOutStats.qualityLimitationDurations;
      // A record of the total time, in seconds, that this stream has spent in each quality
      // limitation state.
      partialStats.qualityLimitationReason = currOutStats.qualityLimitationReason;
      partialStats.firCount = report.firCount;
      partialStats.pliCount = report.pliCount;
      
      if (prevOutStats == null)
        prevOutStats = currOutStats;
      
      const deltaEncodeTime = currOutStats.totalEncodeTime - prevOutStats.totalEncodeTime;
      // The total number of seconds that packets have spent buffered locally before being
      // transmitted onto the network. The time is measured from when a packet is emitted from the
      // RTP packetizer until it is handed over to the OS network socket.
      const deltaPacketSendDelay = currOutStats.totalPacketSendDelay - prevOutStats.totalPacketSendDelay;
      const deltaPacketsSent = currOutStats.packetsSent - prevOutStats.packetsSent;
      const deltaFramesEncoded = currOutStats.framesEncoded - prevOutStats.framesEncoded;
      const deltaqpSum = currOutStats.qpSum - prevOutStats.qpSum;
      const deltaQualityLimitNone = currOutStats.qualityLimitationDurations.none - prevOutStats.qualityLimitationDurations.none;
      const deltaQualityLimitCpu = currOutStats.qualityLimitationDurations.cpu - prevOutStats.qualityLimitationDurations.cpu;
      
      const deltaOutStats =
          Object.assign(partialStats,
                        {"[qpSum/framesEncoded]": (deltaqpSum / deltaFramesEncoded).toFixed(1)},
                        {ms:{"[totalEncodeTime/framesEncoded]": (1000 * deltaEncodeTime / deltaFramesEncoded).toFixed(1),
                             "[totalPacketSendDelay/packetsSent]": (1000 * deltaPacketSendDelay / deltaPacketsSent).toFixed(1)}},
                        {fps:{framesEncoded: currOutStats.framesEncoded - prevOutStats.framesEncoded,
                              framesSent: currOutStats.framesSent - prevOutStats.framesSent}},
                        {"%":{"qualityLimitationDurations.cpu": Math.min(100, (100 * deltaQualityLimitCpu).toFixed(1))}});
      
      senderStatsDiv.textContent = `${currOutStats.type}:\n` + prettyJson(deltaOutStats);
      prevOutStats = currOutStats;
    }
  });
}

/*
{
  "id": "IT01V2294351567",
  "timestamp": 1697981962773.141,
  "type": "inbound-rtp",
  "codecId": "CIT01_96",
  "kind": "video",
  "mediaType": "video",
  "ssrc": 2294351567,
  "transportId": "T01",
  "jitter": 0.002,
  "packetsLost": 0,
  "packetsReceived": 2836,
  "bytesReceived": 2703176,
  "contentType": "screenshare",
  "firCount": 0,
  "frameHeight": 1440,
  "frameWidth": 2560,
  "framesAssembledFromMultiplePackets": 367,
  "framesDecoded": 555,
  "framesDropped": 0,
  "framesPerSecond": 1,
  "framesReceived": 555,
  "freezeCount": 6,
  "googTimingFrameInfo": "3426605772,539686083,539686119,539686124,539686124,539686124,539686083,539686083,539686125,539686125,539686157,539686161,539686182,0,1",
  "headerBytesReceived": 107721,
  "jitterBufferDelay": 22.956317,
  "jitterBufferEmittedCount": 555,
  "jitterBufferMinimumDelay": 32.765127,
  "jitterBufferTargetDelay": 32.765127,
  "keyFramesDecoded": 1,
  "lastPacketReceivedTimestamp": 1697981962242.721,
  "mid": "0",
  "nackCount": 0,
  "pauseCount": 0,
  "pliCount": 0,
  "qpSum": 16550,
  "retransmittedBytesReceived": 16069,
  "retransmittedPacketsReceived": 163,
  "rtxSsrc": 4090590679,
  "totalAssemblyTime": 1.229141,
  "totalDecodeTime": 2.9450589999999996,
  "totalFreezesDuration": 6.013,
  "totalInterFrameDelay": 26.295,
  "totalPausesDuration": 0,
  "totalProcessingDelay": 25.949949,
  "totalSquaredInterFrameDelay": 6.934711000000003,
  "trackIdentifier": "452695f2-fb74-4038-8b9e-818d8fad7780"
}
*/

// https://w3c.github.io/webrtc-stats/#dom-rtcinboundrtpstreamstats-jitterbufferdelay
function showRemoteStats(results) {
  results.forEach(report => {
    const partialStats = {};
    if (report.type === 'inbound-rtp') {
      partialStats.framesDecoded = report.framesDecoded;
      // The total number of frames dropped prior to decode or dropped because the frame missed its
      // display deadline for this receiver's track.
      partialStats.framesDropped = report.framesDropped;
      // The number of decoded frames in the last second
      partialStats.decodedFramesPerSecond = report.framesPerSecond;
      // Represents the total number of complete frames received on this RTP stream.
      partialStats.framesReceived = report.framesReceived;
      partialStats.freezeCount = report.freezeCount;
      // Count the total number of Full Intra Request (FIR) packets sent by this receiver.
      partialStats.firCount = report.firCount;
      // Counts the total number of Picture Loss Indication (PLI) packets.
      partialStats.pliCount = report.pliCount;
      
      
      if (prevInStats == null)
        prevInStats = report;
      
      // It is the sum of the time, in seconds, each video frame takes from the time the first RTP
      // packet is received and to the time the corresponding sample or frame is decoded.
      const deltaProcessingDelay = report.totalProcessingDelay - prevInStats.totalProcessingDelay;
      const deltaDecodeTime = report.totalDecodeTime - prevInStats.totalDecodeTime;
      // The average jitter buffer delay can be calculated by dividing the jitterBufferDelay with
      // the jitterBufferEmittedCount.
      const deltaJitterBufferDelay = report.jitterBufferDelay - prevInStats.jitterBufferDelay;
      const deltaJitterBufferEmittedCount = report.jitterBufferEmittedCount - prevInStats.jitterBufferEmittedCount;
      const deltaAssemblyTime = report.totalAssemblyTime - prevInStats.totalAssemblyTime;
      const deltaFramesAssembledFromMultiplePackets = report.framesAssembledFromMultiplePackets - prevInStats.framesAssembledFromMultiplePackets;
      
      const deltaFramesDecoded = report.framesDecoded - prevInStats.framesDecoded;
      const deltaqpSum = report.qpSum - prevInStats.qpSum;  
      
      const deltaInStats =
          Object.assign(partialStats,
                        {"[qpSum/framesDecoded]": (deltaqpSum / deltaFramesDecoded).toFixed(1)},
                        {ms:{"[totalProcessingDelay/framesDecoded]": (1000 * deltaProcessingDelay / deltaFramesDecoded).toFixed(1),
                             "[jitterBufferDelay/jitterBufferEmittedCount]": (1000 * deltaJitterBufferDelay / deltaJitterBufferEmittedCount).toFixed(1),
                             "[totalDecodeTimeTime/framesDecoded]": (1000 * deltaDecodeTime / deltaFramesDecoded).toFixed(1),
                             "[totalAssemblyTime/framesAssembledFromMultiplePackets]": (1000 * deltaAssemblyTime / deltaFramesAssembledFromMultiplePackets).toFixed(1)}},
                        {fps:{framesDecoded: report.framesDecoded - prevInStats.framesDecoded,
                              framesReceived: report.framesReceived - prevInStats.framesReceived}});
      
      receiverStatsDiv.textContent = 'remote ' + `${report.type}:\n` + prettyJson(deltaInStats);
      prevInStats = report;
    }
  });
}

// Display statistics
setInterval(() => {
  if (!updateStats.checked) {
    return;
  }
  if (localStream) {
    const [track] = localStream.getTracks();
    const currStats = track.stats.toJSON();
    currStats.droppedFrames = currStats.totalFrames - currStats.deliveredFrames - currStats.discardedFrames;
    if (prevStats == null)
    	prevStats = currStats;
    const deltaStats =
        Object.assign(currStats,
    									{fps:{delivered: currStats.deliveredFrames - prevStats.deliveredFrames,
    									      discarded: currStats.discardedFrames - prevStats.discardedFrames,
                            dropped: currStats.droppedFrames - prevStats.droppedFrames,
                            total: currStats.totalFrames - prevStats.totalFrames}});
    localTrackStatsDiv.textContent = 'track.stats:\n' + prettyJson(deltaStats);
    // localTrackStatsDiv.innerHTML = prettyJson(deltaStats).replaceAll(' ', '&nbsp;').replaceAll('\n', '<br/>');
    prevStats = currStats;
  }
  if (localPeerConnection && remotePeerConnection) {
    localPeerConnection
        .getStats(null)
        .then(showLocalStats, err => console.log(err));
    remotePeerConnection
        .getStats(null)
        .then(showRemoteStats, err => console.log(err));
  }
  if (localVideo.videoWidth) {
    const width = localVideo.videoWidth;
    const height = localVideo.videoHeight;
    localVideoSizeDiv.innerHTML = `<strong>Local video dimensions:</strong> ${width}x${height}px`;
    localVideoFpsDiv.innerHTML = `<strong>Local video framerate:</strong> ${localFps.toFixed(1)} fps`;
  }
  if (remoteVideo.videoWidth) {
    const width = remoteVideo.videoWidth;
    const height = remoteVideo.videoHeight;
    remoteVideoSizeDiv.innerHTML = `<strong>Remote video dimensions:</strong> ${width}x${height}px`;
    remoteVideoFpsDiv.innerHTML = `<strong>Remote video framerate:</strong> ${remoteFps.toFixed(1)} fps`;
  }
}, 1000);

const updateVideoFps = () => {
  const now = performance.now();
  const periodMs = now - oldTimestampMs;
  oldTimestampMs = now;
  
  if (localVideo.getVideoPlaybackQuality()) {
    let newFps;
    const newFrames = localVideo.getVideoPlaybackQuality().totalVideoFrames;
    const framesSinceLast = newFrames - oldLocalFrames;
    oldLocalFrames = newFrames;
    if (framesSinceLast >= 0) {
      newFps = 1000 * framesSinceLast / periodMs;
      localFps = 0.9 * localFps + 0.1 * newFps;
    }
  }
  
  if (remoteVideo.getVideoPlaybackQuality()) {
    let newFps;
    const newFrames = remoteVideo.getVideoPlaybackQuality().totalVideoFrames;
    const framesSinceLast = newFrames - oldRemoteFrames;
    oldRemoteFrames = newFrames;
    if (framesSinceLast >= 0) {
      newFps = 1000 * framesSinceLast / periodMs;
      remoteFps = 0.9 * remoteFps + 0.1 * newFps;
    }
  }
  
  setTimeout(updateVideoFps, 30);
}

main();

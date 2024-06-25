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
const applyConstraintsButton = document.getElementById('applyConstraintsButton');
const resetDelayStatsButton = document.getElementById('resetDelayStatsButton');

callButton.disabled = true;
hangupButton.disabled = true;
applyConstraintsButton.disabled = true;
resetDelayStatsButton.disabled = true;
startButton.addEventListener('click', start);
callButton.addEventListener('click', call);
hangupButton.addEventListener('click', hangup);

let startTime;

const localVideo = document.querySelector('div#localVideo video');
const remoteVideo = document.querySelector('div#remoteVideo video');
const localVideoSizeDiv = document.querySelector('div#localVideo div');
const remoteVideoSizeDiv = document.querySelector('div#remoteVideo div');

const localVideoFpsDiv = document.querySelector('div#localVideoFramerate');
const remoteVideoFpsDiv = document.querySelector('div#remoteVideoFramerate');

const getDisplayMediaConstraintsDiv = document.querySelector('div#getDisplayMediaConstraints');

const localTrackStatsDiv = document.querySelector('div#localTrackStats');
const mediaSourceStatsDiv = document.querySelector('div#mediaSourceStats');
const senderStatsDiv = document.querySelector('div#senderStats');
const receiverStatsDiv = document.querySelector('div#receiverStats');
const transportStatsDiv = document.querySelector('div#transportStats');

const codecSelector = document.querySelector('#codec');
codecSelector.disabled = true;

let oldTimestampMs = 0;
let oldLocalFrames = 0;
let localFps = 30;
let oldRemoteFrames = 0;
let remoteFps = 30;

function main() {
  setTimeout(updateVideoFps, 30);
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
}

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
}

let localStream;
let localPeerConnection;
let remotePeerConnection;
let prevStats = null;
let prevOutStats = null;
let prevInStats = null;
let numInboundRtpReports = 0;
let totalCaptureToEncodeDelay = 0;
let totalEncodeDelay = 0;
let totalPacketizationDelay = 0;
let totalPacerDelay = 0;
let totalPacketReceiveDelay = 0;
let totalJitterBufferDelay = 0;
let totalDecodeDelay = 0;
let totalE2EDelay = 0;
let oldReportTimeMs = 0;

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
  console.log('getDisplayMedia options=', prettyJson(options));
  navigator.mediaDevices.getDisplayMedia(options)
    .then(handleSuccess, handleError);
}

function handleSuccess(stream) {
  startButton.disabled = true;
  applyConstraintsButton.disabled = false;
  codecSelector.disabled = false;
  
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

let resetDelayStats = () => {
  numInboundRtpReports = 0;
  totalCaptureToEncodeDelay = 0;
  totalEncodeDelay = 0;
  totalPacketizationDelay = 0;
  totalPacerDelay = 0;
  totalPacketReceiveDelay = 0;
  totalJitterBufferDelay = 0;
  totalDecodeDelay = 0;
  totalE2EDelay = 0;
}

applyConstraintsButton.onclick = async () => {
  resetDelayStats();
  const constraints = getDisplayMediaConstraints();
  console.log('Requested applyConstraints:', prettyJson(constraints));
  if (localStream) {
    const [track] = localStream.getVideoTracks();
    await track.applyConstraints(constraints);
  }
}

resetDelayStatsButton.onclick = async () => {
  resetDelayStats();
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

codecSelector.onchange = () => {
  console.log('New codec selected:', codec.value);
  // if (stream) {
  //   setupPeerConnection();
  // }
};

async function call() {
  callButton.disabled = true;
  hangupButton.disabled = false;
  resetDelayStatsButton.disabled = false;
  codecSelector.disabled = true;
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
  
  const transceiver = localPeerConnection.getTransceivers()[0];
  if (transceiver.setCodecPreferences) {
    const codecs = RTCRtpReceiver.getCapabilities('video').codecs.filter(
      (c) => c.mimeType.includes(codec.value),
    );
    transceiver.setCodecPreferences(codecs);
  }

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
  applyConstraintsButton.disabled = true;
  resetDelayStatsButton.disabled = true;
  codecSelector.disabled = false;
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

function showLocalStats(report) {
  report.forEach(stats => {
    const partialStats = {};
    if (stats.type === 'media-source') {
      partialStats.frames = stats.frames;
      // The number of encoded frames during the last second.
      partialStats.framesPerSecond = stats.framesPerSecond;
      partialStats.height = stats.height;
      partialStats.width = stats.width;
      mediaSourceStatsDiv.textContent = `${stats.type}:\n` + prettyJson(partialStats);
    } else if (stats.type === 'outbound-rtp') {
      // https://w3c.github.io/webrtc-stats/#outboundrtpstats-dict*
      const currOutStats = stats;
      partialStats.contentType = currOutStats.contentType;
      const mimeType = report.get(currOutStats.codecId).mimeType;
      partialStats.codec = mimeType.split('/')[1];
      partialStats.encoderImplementation = currOutStats.encoderImplementation;
      partialStats.powerEfficientEncoder = currOutStats.powerEfficientEncoder;
      partialStats.scalabilityMode = currOutStats.scalabilityMode;
      partialStats.framesSent = currOutStats.framesSent;
      partialStats.framesPerSecond = currOutStats.framesPerSecond;
      partialStats.framesEncoded = currOutStats.framesEncoded;
      partialStats.qualityLimitationDurations = currOutStats.qualityLimitationDurations;
      // A record of the total time, in seconds, that this stream has spent in each quality
      // limitation state.
      partialStats.qualityLimitationReason = currOutStats.qualityLimitationReason;
      partialStats.firCount = stats.firCount;
      partialStats.pliCount = stats.pliCount;
      
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
  // RTCStats
  "id": "IT01V2294351567",
  "timestamp": 1697981962773.141,
  "type": "inbound-rtp",
  
  // RTCRtpStreamStats
  "codecId": "CIT01_96",
  "kind": "video",
  "mediaType": "video",
  "ssrc": 2294351567,
  
  // RTCReceivedRtpStreamStats
  "transportId": "T01",
  "jitter": 0.002,
  "packetsLost": 0,
  
  // RTCInboundRtpStreamStats
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

/*
googTimingFrameInfo

Timing frames are reported via old GetStats() by the name “GoogTimingFrameInfo” for video receive
stream. On each call the frame with the longest e2e delay received during last 1 seconds is returned.
If NTP time estimation is not yet available, last available frame is returned. If no frames were
caught since last call nothing is returned. Timestamps are reported as a single comma separated
string: rtp timestamp (32-bit) + 12 timestamps (64-bit each) + 2 flags (0 or 1) indicating if this
timing frame was caused by abnormal size or/and timer (in that order). If sender clock is not
estimated yet, first 7 timestamps after rtp will be negative (capture, encode start/finish,
packetization done, pacer exit and 2 network timestamps),
e.g., “194057,-28,-17,-5,-5,-1,-28,-28,775795001,775795001,775795020,775795021,775795032, 0, 1”. 
Even in that case 5 timestamps will be relatively correct: capture, encode start and finish,
packetization and pacer timestamps. All receiver timestamps will always be positive.

The following timestamps are recorded for the frame:

1 Capture time
2 Encode start
3 Encode complete
4 Frame packetization end
5 Last packet left pacer (may be incorrect if the last packet is recovered by FEC)
6 Reflector timestamp in
7 Reflector timestamp out
8 First packet of frame received
9 Last packet of frame received
10 Decode start
11 Decode complete
12 Smooth predicted render time (WebRTC estimates at what time frame should be rendered to balance delay vs smooth playback).
*/

// https://w3c.github.io/webrtc-stats/#summary
// https://w3c.github.io/webrtc-stats/#dom-rtcinboundrtpstreamstats-jitterbufferdelay
function showRemoteStats(report) {
  
  if (oldReportTimeMs == 0)
    oldReportTimeMs = performance.now();
  const now = performance.now();
  const deltaReportTimeMs = now - oldReportTimeMs;
  oldReportTimeMs = now;
  console.log(deltaReportTimeMs);
  console.log(report);
  
  report.forEach(stats => {
    const partialStats = {};
    if (stats.type === 'transport') {
        // const candidatePair = report.get(stats.selectedCandidatePairId);
        // if (candidatePair) {
        //  partialStats.currentRoundTripTime = candidatePair.currentRoundTripTime;
        //  transportStatsDiv.textContent = `${stats.type}:\n` + prettyJson(partialStats);
        // }
    } else if (stats.type === 'inbound-rtp') {
      // if (stats.remoteId != undefined) {
      //   const remoteOutboundRtp = stats.get(report.remoteId);
      //   console.log(remoteOutboundRtp);
      // }
      partialStats.decoderImplementation = stats.decoderImplementation;
      partialStats.powerEfficientDecoder = stats.powerEfficientDecoder;
      partialStats.framesDecoded = stats.framesDecoded;
      // The total number of frames dropped prior to decode or dropped because the frame missed its
      // display deadline for this receiver's track.
      partialStats.framesDropped = stats.framesDropped;
      // The number of decoded frames in the last second
      partialStats.decodedFramesPerSecond = stats.framesPerSecond;
      // Represents the total number of complete frames received on this RTP stream.
      partialStats.framesReceived = stats.framesReceived;
      partialStats.freezeCount = stats.freezeCount;
      // Count the total number of Full Intra Request (FIR) packets sent by this receiver.
      partialStats.firCount = stats.firCount;
      // Counts the total number of Picture Loss Indication (PLI) packets.
      partialStats.pliCount = stats.pliCount;
      
      const timingFrameInfo = stats.googTimingFrameInfo;
      let infos = [];
      let currentE2Edelay = 0;
      if (timingFrameInfo != undefined) { 
        const infos = timingFrameInfo.split(',');
        if (infos[1] >= 0 && infos[2] >= 0 && infos[3] >= 0
            && infos[4] >= 0 && infos[5] >= 0 && infos[6] >= 0
            && infos[7] >= 0) {
          numInboundRtpReports++;
          totalCaptureToEncodeDelay += infos[2] - infos[1];
          totalEncodeDelay += infos[3] - infos[2];
          totalPacketizationDelay += infos[4] - infos[3];
          totalPacerDelay += infos[5] - infos[4];
          totalPacketReceiveDelay += infos[9] - infos[8];
          totalJitterBufferDelay += infos[10] - infos[9];
          totalDecodeDelay += infos[11] - infos[10];
          const e2e = infos[11] - infos[1];
          totalE2EDelay += e2e;
          currentE2Edelay = e2e;
        }
      } 
      
      if (prevInStats == null)
        prevInStats = stats;
      
      // It is the sum of the time, in seconds, each video frame takes from the time the first RTP
      // packet is received and to the time the corresponding sample or frame is decoded.
      const deltaProcessingDelay = stats.totalProcessingDelay - prevInStats.totalProcessingDelay;
      const deltaDecodeTime = stats.totalDecodeTime - prevInStats.totalDecodeTime;
      // The average jitter buffer delay can be calculated by dividing the jitterBufferDelay with
      // the jitterBufferEmittedCount.
      const deltaJitterBufferDelay = stats.jitterBufferDelay - prevInStats.jitterBufferDelay;
      const deltaJitterBufferEmittedCount = stats.jitterBufferEmittedCount - prevInStats.jitterBufferEmittedCount;
      const deltaAssemblyTime = stats.totalAssemblyTime - prevInStats.totalAssemblyTime;
      const deltaFramesAssembledFromMultiplePackets = stats.framesAssembledFromMultiplePackets - prevInStats.framesAssembledFromMultiplePackets;
      
      const deltaFramesDecoded = stats.framesDecoded - prevInStats.framesDecoded;
      const deltaqpSum = stats.qpSum - prevInStats.qpSum;  
      
      const deltaInStats =
          Object.assign(partialStats,
                        {"[qpSum/framesDecoded]": (deltaqpSum / deltaFramesDecoded).toFixed(1)},
                        {ms:{"[totalProcessingDelay/framesDecoded]": (1000 * deltaProcessingDelay / deltaFramesDecoded).toFixed(1),
                             "[jitterBufferDelay/jitterBufferEmittedCount]": (1000 * deltaJitterBufferDelay / deltaJitterBufferEmittedCount).toFixed(1),
                             "[totalDecodeTimeTime/framesDecoded]": (1000 * deltaDecodeTime / deltaFramesDecoded).toFixed(1),
                             "[totalAssemblyTime/framesAssembledFromMultiplePackets]": (1000 * deltaAssemblyTime / deltaFramesAssembledFromMultiplePackets).toFixed(1),
                             // Packet Jitter measured in seconds for this SSRC. Calculated as defined in section 6.4.1. of [RFC3550].
                             jitter: (1000 * stats.jitter).toFixed(1),
                             currentE2Edelay: currentE2Edelay}},
                        {fps:{framesDecoded: stats.framesDecoded - prevInStats.framesDecoded,
                              framesReceived: stats.framesReceived - prevInStats.framesReceived}},
                        {"[TX mean] ms":{captureToEncodeDelay: (totalCaptureToEncodeDelay / numInboundRtpReports).toFixed(1),
                                encodeDelay: (totalEncodeDelay / numInboundRtpReports).toFixed(1),
                                packetizationDelay: (totalPacketizationDelay / numInboundRtpReports).toFixed(1),
                                pacerDelay: (totalPacerDelay / numInboundRtpReports).toFixed(1)}},
                        {"[RX mean] ms":{packetReceiveDelay: (totalPacketReceiveDelay / numInboundRtpReports).toFixed(1),
                                jitterBufferDelay: (totalJitterBufferDelay / numInboundRtpReports).toFixed(1),
                                decodeDelay: (totalDecodeDelay / numInboundRtpReports).toFixed(1)}},
                        {"[E2E mean] ms":{E2Edelay: (totalE2EDelay / numInboundRtpReports).toFixed(1)}});
      
      receiverStatsDiv.textContent = 'remote ' + `${stats.type}:\n` + prettyJson(deltaInStats);
      prevInStats = stats;
    }
  });
}

// Display statistics
setInterval(() => {
  if (localStream) {
    const [track] = localStream.getTracks();
    if (track.stats != undefined) {
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

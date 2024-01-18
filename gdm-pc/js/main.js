// Based on https://jsfiddle.net/henbos/m08wjqtk/ and
// https://jsfiddle.net/5ve4gbjx/3/.

'use strict';

let stream;
let deviceId;
let pc1 = null;
let pc2 = null;
let prevTrackStats = null;

let trackStatsIntervalId;
let videoRateIntervalId;

let oldTimestampMs = 0;
let oldLocalFrames = 0;
let localFps = 30;
let oldRemoteFrames = 0;
let remoteFps = 30;

const localVideo = document.getElementById('local');
const remoteVideo = document.getElementById('remote');
const localVideoRateDiv = document.getElementById('localVideoRate');
const remoteVideoRateDiv = document.getElementById('remoteVideoRate');

const startButton = document.getElementById('start');
const callButton = document.getElementById('call');
const hangupButton = document.getElementById('hangup');
const applyConstraintsButton = document.getElementById('applyConstraints');

const trackStats = document.getElementById('trackStats');

callButton.disabled = true;
hangupButton.disabled = true;
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

const dumpStats1 = () => {
  console.log('dumpStats1');
  pc1.getStats().then(
    (report) => {
      report.forEach((stats) => {
        console.log(prettyJson(stats));
      });
    }
  );
};

const dumpStats2 = async () => {
  console.log('dumpStats2');
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

const applyConstraints = async () => {
  if (stream) {
    const constraints = getDisplayMediaConstraints();
    console.log('Requested constraints:', prettyJson(constraints));
    const [track] = stream.getVideoTracks();
    await track.applyConstraints(constraints);
    const actualConstraints = track.getConstraints();
    console.log('Actual constraints:', prettyJson(actualConstraints));
  }
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
  
  pc1.oniceconnectionstatechange = (e) => {
    console.log('pc1 ICE state: ' + pc1.iceConnectionState)
  }
  
  pc2.oniceconnectionstatechange = (e) => {
    console.log('pc2 ICE state: ' + pc2.iceConnectionState)
  }
  
  // codec...
  
  const offer = await pc1.createOffer();
  await pc1.setLocalDescription(offer);
  await pc2.setRemoteDescription(offer);
  console.log('pc1 offer: ', offer.sdp);
  
  const answer = await pc2.createAnswer();
  await pc2.setLocalDescription(answer);
  await pc1.setRemoteDescription(answer);
  console.log('pc2 answer: ', answer.sdp);
  
  // TODO(henrika): select best method.
  dumpStats1();
  dumpStats2();
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
      
      // getDisplayMedia and an initial applyConstraints.
      stream = await navigator.mediaDevices.getDisplayMedia(options);
      applyConstraints();
      localVideo.srcObject = stream;
      
      const [localTrack] = stream.getVideoTracks();
      const settings = localTrack.getSettings();
      console.log('MediaStreamTrack: getSettings: ', settings);
      deviceId = settings.deviceId;
      
      // Triggers when the user has stopped sharing the screen via the browser UI.
      localTrack.addEventListener('ended', () => {
        console.log('User stopped sharing content');
        localVideoRateDiv.textContent = '';
        startButton.disabled = false;
        callButton.disabled = true;
        if (videoRateIntervalId) {
          clearInterval(videoRateIntervalId);
        }
        if (trackStatsIntervalId) {
          clearInterval(trackStatsIntervalId);
        }
        hangup();
      });
      
      // Start timer which updates track.stats on the local track.
      // https://w3c.github.io/mediacapture-extensions/#the-mediastreamtrackvideostats-interface
      // This timer also updates the filtered frame rates for local and remote screenshare streams.
      trackStatsIntervalId = setInterval(() => {
        if (stream) {
          if (localTrack.stats != undefined) {
            const currStats = localTrack.stats.toJSON();
            currStats.droppedFrames = currStats.totalFrames - currStats.deliveredFrames - currStats.discardedFrames;
            if (prevTrackStats == null) {
              prevTrackStats = currStats;
            }
            const deltaStats =
              Object.assign(currStats,
    									      {fps:{delivered: currStats.deliveredFrames - prevTrackStats.deliveredFrames,
    									            discarded: currStats.discardedFrames - prevTrackStats.discardedFrames,
                                  dropped: currStats.droppedFrames - prevTrackStats.droppedFrames,
                                  total: currStats.totalFrames - prevTrackStats.totalFrames}});
            trackStats.textContent = 'track.stats:\n' + prettyJson(deltaStats);
            prevTrackStats = currStats; 
          }
        }
        
        if (localVideo.videoWidth) {
          const width = localVideo.videoWidth;
          const height = localVideo.videoHeight;
          localVideoRateDiv.innerHTML =
              `[${deviceId}][${width}x${height} px] <strong>${localFps.toFixed(1)} fps</strong>`;
        }
        
        if (remoteVideo.videoWidth) {
          const width = remoteVideo.videoWidth;
          const height = remoteVideo.videoHeight;
          remoteVideoRateDiv.innerHTML =
              `[${width}x${height} px] <strong>${remoteFps.toFixed(1)} fps</strong>`;
        }
        
      }, 1000);
      
      // Calculates frame rates for local and remote video streams using exponential moving average
      // (EMA) filters.
      videoRateIntervalId = setInterval(() => {
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
      }, 30);
      
      startButton.disabled = true;
      callButton.disabled = false;
      applyConstraintsButton.disabled = false;
    }
  } catch (e) {
    loge(e);
  }
};

applyConstraintsButton.onclick = applyConstraints;

callButton.onclick = async () => {
  await setupPeerConnection();
  
  callButton.disabled = true;
  hangupButton.disabled = false;
  
  // codecSelector.disabled = true;
  // startTime = window.performance.now();
};

const hangup = () => {
  console.log('hangup');
  closePeerConnection();
  remoteVideoRateDiv.textContent = '';
  hangupButton.disabled = true;
  callButton.disabled = false;
  applyConstraintsButton.disabled = true;
  // codecSelector.disabled = false;
};

hangupButton.onclick = hangup;



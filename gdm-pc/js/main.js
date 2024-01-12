// Based on https://jsfiddle.net/henbos/m08wjqtk/ and
// https://jsfiddle.net/5ve4gbjx/3/.

let pc1 = null;
let pc2 = null;

const localVideo = document.getElementById('local');
const remoteVideo = document.getElementById('remote');

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
/*


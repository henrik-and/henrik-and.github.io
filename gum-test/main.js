const resultsContainer = document.getElementById('test-results');
const runBtn = document.getElementById('run-tests-btn');

const tests = [
    {
        name: "getUserMedia({audio: true}) - Default Microphone",
        run: async (logger) => {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                return { pass: false, details: "navigator.mediaDevices.getUserMedia is not available. Ensure you are in a secure context (HTTPS or localhost)." };
            }

            logger.log("Requesting getUserMedia...");
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                logger.log("GUM resolved successfully.");
                
                if (!stream) {
                    return { pass: false, details: "Stream is null or undefined" };
                }
                
                const audioTracks = stream.getAudioTracks();
                logger.log(`Found ${audioTracks.length} audio tracks.`);
                
                if (audioTracks.length === 0) {
                    return { pass: false, details: "No audio tracks in stream" };
                }
                
                const track = audioTracks[0];
                logger.log(`Track Label: ${track.label}`);
                logger.log(`Track ReadyState: ${track.readyState}`);
                logger.log(`Track Enabled: ${track.enabled}`);
                
                if (track.readyState !== 'live') {
                    track.stop();
                    return { pass: false, details: `Track readyState is ${track.readyState}, expected 'live'` };
                }
                
                let audioFlowing = false;
                let methodUsed = "";
                
                // Try MediaStreamTrack.stats first
                if (track.stats) {
                    logger.log("MediaStreamTrack.stats is available. Verifying audio flow via stats...");
                    methodUsed = "Stats API";
                    audioFlowing = await verifyAudioFlowStats(track, logger);
                } else {
                    logger.log("MediaStreamTrack.stats is NOT available. Falling back to Web Audio Analyser...");
                    methodUsed = "Web Audio Analyser";
                    audioFlowing = await verifyAudioFlow(stream, logger);
                }
                
                // Stop the stream tracks after test
                track.stop();
                
                if (audioFlowing) {
                    return { pass: true, details: `Stream active and audio flow detected via ${methodUsed}.` };
                } else {
                    return { pass: false, details: `Stream active but no audio flow detected via ${methodUsed} (silent/no data).` };
                }
                
            } catch (err) {
                logger.log(`GUM failed with error: ${err.name} - ${err.message}`);
                return { pass: false, details: `Error: ${err.name} - ${err.message}` };
            }
        }
    }
];

async function verifyAudioFlowStats(track, logger) {
    return new Promise((resolve) => {
        try {
            let stats = track.stats;
            if (!stats) {
                logger.log("track.stats returned null/undefined");
                resolve(false);
                return;
            }
            
            let initialFrames = stats.deliveredFrames;
            logger.log(`Initial delivered frames: ${initialFrames}`);
            
            let startTime = performance.now();
            let checkCount = 0;
            
            function check() {
                checkCount++;
                const currentStats = track.stats;
                if (!currentStats) {
                    logger.log("Failed to get current track.stats");
                    resolve(false);
                    return;
                }
                
                let currentFrames = currentStats.deliveredFrames;
                logger.log(`Check #${checkCount}: delivered frames: ${currentFrames}`);
                
                if (currentFrames > initialFrames) {
                    logger.log(`Frames delivery verified: ${currentFrames - initialFrames} new frames detected.`);
                    resolve(true);
                } else if (performance.now() - startTime > 3000) { // 3 seconds timeout
                    logger.log("Timeout waiting for delivered frames to increase.");
                    resolve(false);
                } else {
                    setTimeout(check, 200); // Check every 200ms
                }
            }
            
            setTimeout(check, 200);
        } catch (e) {
            logger.log(`Error in verifyAudioFlowStats: ${e.message}`);
            resolve(false);
        }
    });
}

async function verifyAudioFlow(stream, logger) {
    return new Promise((resolve) => {
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            const audioContext = new AudioContextClass();
            
            logger.log(`AudioContext state: ${audioContext.state}`);
            
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            let startTime = performance.now();
            let hasData = false;
            
            if (audioContext.state === 'suspended') {
                logger.log("AudioContext is suspended, attempting to resume...");
                audioContext.resume().then(() => {
                    logger.log(`AudioContext state after resume: ${audioContext.state}`);
                }).catch(err => {
                    logger.log(`Failed to resume AudioContext: ${err.message}`);
                });
            }
            
            function check() {
                analyser.getByteFrequencyData(dataArray);
                const sum = dataArray.reduce((a, b) => a + b, 0);
                if (sum > 0) {
                    hasData = true;
                    logger.log(`Audio energy detected: ${sum}`);
                    cleanup();
                    resolve(true);
                } else if (performance.now() - startTime > 3000) { // 3 seconds timeout
                    logger.log("Timeout waiting for audio energy. Data was all zeros.");
                    cleanup();
                    resolve(false);
                } else {
                    requestAnimationFrame(check);
                }
            }
            
            function cleanup() {
                source.disconnect();
                analyser.disconnect();
                audioContext.close();
            }
            
            requestAnimationFrame(check);
        } catch (e) {
            logger.log(`Failed to setup Web Audio verification: ${e.message}`);
            resolve(false);
        }
    });
}

class TestLogger {
    constructor(element) {
        this.element = element;
        this.logs = [];
    }
    log(msg) {
        console.log(msg);
        this.logs.push(msg);
        this.element.textContent = this.logs.join('\n');
    }
}

async function runAllTests() {
    resultsContainer.innerHTML = '';
    runBtn.disabled = true;
    
    for (const test of tests) {
        const testEl = document.createElement('div');
        testEl.className = 'test-item';
        testEl.innerHTML = `
            <div class="test-header">
                <span class="test-name">${test.name}</span>
                <span class="test-status status-pending">PENDING</span>
            </div>
            <pre class="test-details">Initializing...</pre>
        `;
        resultsContainer.appendChild(testEl);
        
        const statusEl = testEl.querySelector('.test-status');
        const detailsEl = testEl.querySelector('.test-details');
        
        statusEl.className = 'test-status status-running';
        statusEl.textContent = 'RUNNING';
        
        const logger = new TestLogger(detailsEl);
        
        const result = await test.run(logger);
        
        if (result.pass) {
            statusEl.className = 'test-status status-pass';
            statusEl.textContent = 'PASS';
        } else {
            statusEl.className = 'test-status status-fail';
            statusEl.textContent = 'FAIL';
        }
        
        logger.log(`\nResult: ${result.pass ? 'PASS' : 'FAIL'}`);
        if (result.details) {
            logger.log(`Details: ${result.details}`);
        }
    }
    
    runBtn.disabled = false;
}

runBtn.addEventListener('click', runAllTests);

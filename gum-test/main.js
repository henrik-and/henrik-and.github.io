const resultsContainer = document.getElementById('test-results');
const runBtn = document.getElementById('run-tests-btn');

function formatError(error) {
    if (!error) return "Unknown error";
    let details = `${error.name}: ${error.message}`;
    if (error.constraint) {
        details += ` (Constraint: ${error.constraint})`;
    }
    return details;
}

/**
 * Helper to execute a GUM test and manage its lifecycle.
 */
async function executeTest(constraints, verifyFn, logger) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return { pass: false, details: "getUserMedia is not available. Ensure secure context." };
    }

    logger.log(`Requesting GUM with constraints: ${JSON.stringify(constraints)}`);
    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        logger.log("GUM resolved successfully.");
        
        // Run the test-specific verification
        const result = await verifyFn(stream, null, logger);
        
        // Ensure all tracks are stopped after verification
        stream.getTracks().forEach(track => {
            logger.log(`Stopping track: ${track.label}`);
            track.stop();
        });
        
        return result;
    } catch (err) {
        logger.log(`GUM rejected with error: ${err.name} - ${err.message}`);
        // Run verification on the error
        return await verifyFn(null, err, logger);
    }
}

const tests = [
    {
        name: "getUserMedia({audio: true}) - Default Microphone",
        run: async (logger) => {
            return executeTest(
                { audio: true, video: false },
                async (stream, error, logger) => {
                    if (error) return { pass: false, details: `GUM failed: ${formatError(error)}` };
                    
                    const audioTracks = stream.getAudioTracks();
                    if (audioTracks.length === 0) return { pass: false, details: "No audio tracks returned." };
                    
                    const track = audioTracks[0];
                    logger.log(`Track Label: ${track.label}`);
                    
                    if (track.readyState !== 'live') {
                        return { pass: false, details: `Track not live. state: ${track.readyState}` };
                    }
                    
                    let audioFlowing = false;
                    if (track.stats) {
                        logger.log("Verifying audio flow via stats...");
                        audioFlowing = await verifyAudioFlowStats(track, logger);
                    } else {
                        logger.log("Verifying audio flow via Web Audio Analyser...");
                        audioFlowing = await verifyAudioFlow(stream, logger);
                    }
                    
                    return audioFlowing 
                        ? { pass: true, details: "Audio track is live and delivering frames." }
                        : { pass: false, details: "Audio track is live but no frames detected (silent)." };
                },
                logger
            );
        }
    },
    {
        name: "getUserMedia({audio: false}) - Audio False (Should Reject)",
        run: async (logger) => {
            return executeTest(
                { audio: false },
                async (stream, error, logger) => {
                    if (stream) {
                        return { pass: false, details: "GUM should have rejected but resolved." };
                    }
                    return error.name === 'TypeError'
                        ? { pass: true, details: "Correctly rejected with TypeError." }
                        : { pass: false, details: `Expected TypeError, got: ${error.name}` };
                },
                logger
            );
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
        
        const startTime = performance.now();
        const result = await test.run(logger);
        const duration = Math.round(performance.now() - startTime);
        
        if (result.pass) {
            statusEl.className = 'test-status status-pass';
            statusEl.textContent = `PASS (${duration}ms)`;
        } else {
            statusEl.className = 'test-status status-fail';
            statusEl.textContent = `FAIL (${duration}ms)`;
        }
        
        logger.log(`\nResult: ${result.pass ? 'PASS' : 'FAIL'} (${duration}ms)`);
        if (result.details) {
            logger.log(`Details: ${result.details}`);
        }
    }
    
    runBtn.disabled = false;
}

runBtn.addEventListener('click', runAllTests);

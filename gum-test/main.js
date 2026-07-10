const resultsContainer = document.getElementById('test-results');
const runBtn = document.getElementById('run-tests-btn');
const deviceCheckboxesContainer = document.getElementById('device-checkboxes');
const refreshDevicesBtn = document.getElementById('refresh-devices-btn');
const verboseLogsCb = document.getElementById('verbose-logs-cb');

function formatError(error) {
    if (!error) return "Unknown error";
    let details = `${error.name}: ${error.message}`;
    if (error.constraint) {
        details += ` (Constraint: ${error.constraint})`;
    }
    return details;
}

function truncateId(id) {
    if (!id) return id;
    if (id.length <= 8) return id;
    return `${id.slice(0, 4)}...${id.slice(-4)}`;
}

function stringifyConstraints(constraints) {
    const copy = JSON.parse(JSON.stringify(constraints));
    if (copy.audio && copy.audio.deviceId) {
        if (copy.audio.deviceId.exact) {
            copy.audio.deviceId.exact = truncateId(copy.audio.deviceId.exact);
        } else if (typeof copy.audio.deviceId === 'string') {
            copy.audio.deviceId = truncateId(copy.audio.deviceId);
        }
    }
    return JSON.stringify(copy);
}

function stringifySettings(settings) {
    const copy = { ...settings };
    if (copy.deviceId) {
        copy.deviceId = truncateId(copy.deviceId);
    }
    if (copy.groupId) {
        copy.groupId = truncateId(copy.groupId);
    }
    return JSON.stringify(copy);
}

/**
 * Helper to merge deviceId into constraints.
 */
function mergeDeviceConstraint(constraints, deviceId) {
    if (!deviceId) return constraints;
    
    const newConstraints = { ...constraints };
    if (newConstraints.audio) {
        if (newConstraints.audio === true) {
            newConstraints.audio = { deviceId: { exact: deviceId } };
        } else if (typeof newConstraints.audio === 'object') {
            newConstraints.audio = {
                ...newConstraints.audio,
                deviceId: { exact: deviceId }
            };
        }
    }
    return newConstraints;
}

/**
 * Helper to execute a GUM test and manage its lifecycle.
 */
async function executeTest(constraints, verifyFn, logger) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return { pass: false, details: "getUserMedia is not available. Ensure secure context." };
    }

    logger.log(`Requesting GUM with constraints: ${stringifyConstraints(constraints)}`);
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

/**
 * Factory to generate standard GUM audio tests.
 * Performs stream setup, logs settings, checks constraints, and verifies data flow.
 */
function createGUMAudioTest(name, audioConstraints) {
    return {
        name: name,
        run: async (logger, deviceId) => {
            const constraints = mergeDeviceConstraint({ audio: audioConstraints }, deviceId);
            return executeTest(
                constraints,
                async (stream, error, logger) => {
                    if (error) return { pass: false, details: `GUM failed: ${formatError(error)}` };
                    
                    const audioTracks = stream.getAudioTracks();
                    if (audioTracks.length === 0) return { pass: false, details: "No audio tracks returned." };
                    
                    const track = audioTracks[0];
                    logger.log(`Track Label: ${track.label}`);
                    
                    const settings = track.getSettings();
                    logger.log(`Track Settings: ${stringifySettings(settings)}`);
                    
                    if (deviceId && settings.deviceId !== deviceId) {
                        return { pass: false, details: `Device ID mismatch. Requested: ${deviceId}, Got: ${settings.deviceId}` };
                    }
                    
                    // Verify constraints match settings.
                    // - exact: If you use { exact: value } and the browser resolves GUM, we strictly check
                    //   that the final setting matches. If it doesn't, the test fails (exact constraint violated).
                    //   (If the browser doesn't support the value, GUM itself should reject with OverconstrainedError,
                    //   failing the test at the GUM level).
                    // - ideal: If you use { ideal: value }, the test will pass as long as GUM succeeds and audio flows.
                    //   If the setting doesn't match the ideal value, it prints a warning in the log, but keeps the
                    //   test as PASS (since ideal constraints are non-blocking hints).
                    // - Flat values (like true / false): Handled strictly. If they don't match, the test fails.
                    if (typeof audioConstraints === 'object') {
                        for (const key of Object.keys(audioConstraints)) {
                            if (key === 'deviceId') continue;
                            const constraint = audioConstraints[key];
                            const actual = settings[key];
                            
                            let expected = constraint;
                            let isExact = false;
                            let isIdeal = false;
                            
                            if (constraint && typeof constraint === 'object') {
                                if ('exact' in constraint) {
                                    expected = constraint.exact;
                                    isExact = true;
                                } else if ('ideal' in constraint) {
                                    expected = constraint.ideal;
                                    isIdeal = true;
                                }
                            }
                            
                            if (isExact) {
                                if (actual !== expected) {
                                    return { pass: false, details: `Exact constraint mismatch - ${key}. Expected: ${expected}, Got: ${actual}` };
                                }
                            } else if (isIdeal) {
                                if (actual !== expected) {
                                    logger.log(`Warning: Ideal constraint ${key} not met. Requested: ${expected}, Got: ${actual}`);
                                }
                            } else {
                                // Flat value
                                if (actual !== expected) {
                                    return { pass: false, details: `Constraint mismatch - ${key}. Expected: ${expected}, Got: ${actual}` };
                                }
                            }
                        }
                    } else if (audioConstraints === true) {
                        const typicalDefaults = {
                            echoCancellation: true,
                            autoGainControl: true,
                            noiseSuppression: true
                        };
                        for (const key of Object.keys(typicalDefaults)) {
                            const expected = typicalDefaults[key];
                            const actual = settings[key];
                            if (actual !== expected) {
                                logger.log(`Note: Default ${key} is ${actual} (typical Chrome default is ${expected})`);
                            }
                        }
                    }
                    
                    let flowResult = null;
                    if (track.stats) {
                        logger.log("Verifying audio flow via stats...");
                        flowResult = await verifyAudioFlowStats(track, logger);
                    } else {
                        logger.log("Verifying audio flow via Web Audio Analyser...");
                        flowResult = await verifyAudioFlow(stream, logger);
                    }
                    
                    if (flowResult.flowing) {
                        return { pass: true, details: `Audio flowing. Checked constraints: ${JSON.stringify(audioConstraints)}` };
                    } else {
                        if (flowResult.reason === 'ended') {
                            return { pass: false, details: "Track ended prematurely (native layer failure shortly after GUM start)." };
                        } else if (flowResult.reason === 'timeout') {
                            return { pass: false, details: "Audio track is live but no frames detected (silent/no data flow)." };
                        } else {
                            return { pass: false, details: `Flow verification failed: ${flowResult.reason}` };
                        }
                    }
                },
                logger
            );
        }
    };
}

const tests = [
    createGUMAudioTest("getUserMedia({audio: true}) - Default Microphone", true),
    createGUMAudioTest("getUserMedia({audio: {echoCancellation: true}})", { echoCancellation: true }),
    createGUMAudioTest("getUserMedia({audio: {echoCancellation: false}})", { echoCancellation: false }),
    createGUMAudioTest("getUserMedia({audio: {echoCancellation: {exact: 'all'}}})", { echoCancellation: { exact: 'all' } }),
    createGUMAudioTest("getUserMedia({audio: {echoCancellation: {exact: 'remote-only'}}})", { echoCancellation: { exact: 'remote-only' } }),
    createGUMAudioTest("getUserMedia({audio: {echoCancellation: {ideal: 'all'}}})", { echoCancellation: { ideal: 'all' } }),
    createGUMAudioTest("getUserMedia({audio: {echoCancellation: {ideal: 'remote-only'}}})", { echoCancellation: { ideal: 'remote-only' } }),
    createGUMAudioTest("getUserMedia({audio: {autoGainControl: true}})", { autoGainControl: true }),
    createGUMAudioTest("getUserMedia({audio: {autoGainControl: false}})", { autoGainControl: false }),
    createGUMAudioTest("getUserMedia({audio: {autoGainControl: {exact: true}}})", { autoGainControl: { exact: true } }),
    createGUMAudioTest("getUserMedia({audio: {autoGainControl: {exact: false}}})", { autoGainControl: { exact: false } }),
    createGUMAudioTest("getUserMedia({audio: {noiseSuppression: true}})", { noiseSuppression: true }),
    createGUMAudioTest("getUserMedia({audio: {noiseSuppression: false}})", { noiseSuppression: false }),
    createGUMAudioTest("getUserMedia({audio: {noiseSuppression: {exact: true}}})", { noiseSuppression: { exact: true } }),
    createGUMAudioTest("getUserMedia({audio: {noiseSuppression: {exact: false}}})", { noiseSuppression: { exact: false } }),
    {
        name: "getUserMedia({audio: false}) - Audio False (Should Reject)",
        run: async (logger, deviceId) => {
            const constraints = mergeDeviceConstraint({ audio: false }, deviceId);
            return executeTest(
                constraints,
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

/**
 * Verifies audio flow using MediaStreamTrackAudioStats (deliveredFrames).
 * Terminates early if the track receives an 'ended' event (native layer crash).
 */
async function verifyAudioFlowStats(track, logger) {
    return new Promise((resolve) => {
        try {
            let stats = track.stats;
            if (!stats) {
                logger.log("track.stats returned null/undefined");
                resolve({ flowing: false, reason: 'no-stats' });
                return;
            }
            
            let initialFrames = stats.deliveredFrames;
            logger.log(`Initial delivered frames: ${initialFrames}`);
            
            let startTime = performance.now();
            let checkCount = 0;
            let ended = false;
            
            track.onended = () => {
                logger.log("Event: 'ended' triggered on track.");
                ended = true;
            };
            track.onmute = () => {
                logger.log("Event: 'mute' triggered on track. Track is now muted.");
            };
            track.onunmute = () => {
                logger.log("Event: 'unmute' triggered on track. Track is now unmuted.");
            };
            
            function check() {
                if (ended || track.readyState === 'ended') {
                    logger.log("Track ended detected during stats check loop.");
                    cleanup();
                    resolve({ flowing: false, reason: 'ended' });
                    return;
                }
                
                checkCount++;
                const currentStats = track.stats;
                if (!currentStats) {
                    logger.log("Failed to get current track.stats");
                    cleanup();
                    resolve({ flowing: false, reason: 'no-stats' });
                    return;
                }
                
                let currentFrames = currentStats.deliveredFrames;
                logger.log(`Check #${checkCount}: delivered frames: ${currentFrames}`);
                
                if (currentFrames > initialFrames) {
                    logger.log(`Frames delivery verified: ${currentFrames - initialFrames} new frames detected.`);
                    cleanup();
                    resolve({ flowing: true, reason: 'flowing' });
                } else if (performance.now() - startTime > 3000) { // 3 seconds timeout
                    logger.log("Timeout waiting for delivered frames to increase.");
                    cleanup();
                    resolve({ flowing: false, reason: 'timeout' });
                } else {
                    setTimeout(check, 200); // Check every 200ms
                }
            }
            
            function cleanup() {
                track.onended = null;
                track.onmute = null;
                track.onunmute = null;
            }
            
            setTimeout(check, 200);
        } catch (e) {
            logger.log(`Error in verifyAudioFlowStats: ${e.message}`);
            resolve({ flowing: false, reason: 'error', error: e.message });
        }
    });
}

/**
 * Fallback audio flow verifier using Web Audio Analyser to detect volume energy.
 * Useful if the browser does not support track.stats.
 */
async function verifyAudioFlow(stream, logger) {
    const track = stream.getAudioTracks()[0];
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
            let ended = false;
            
            if (audioContext.state === 'suspended') {
                logger.log("AudioContext is suspended, attempting to resume...");
                audioContext.resume().then(() => {
                    logger.log(`AudioContext state after resume: ${audioContext.state}`);
                }).catch(err => {
                    logger.log(`Failed to resume AudioContext: ${err.message}`);
                });
            }
            
            if (track) {
                track.onended = () => {
                    logger.log("Event: 'ended' triggered on track.");
                    ended = true;
                };
                track.onmute = () => {
                    logger.log("Event: 'mute' triggered on track. Track is now muted.");
                };
                track.onunmute = () => {
                    logger.log("Event: 'unmute' triggered on track. Track is now unmuted.");
                };
            }
            
            function check() {
                if (ended || (track && track.readyState === 'ended')) {
                    logger.log("Track ended detected during Web Audio check loop.");
                    cleanup();
                    resolve({ flowing: false, reason: 'ended' });
                    return;
                }
                
                analyser.getByteFrequencyData(dataArray);
                const sum = dataArray.reduce((a, b) => a + b, 0);
                if (sum > 0) {
                    logger.log(`Audio energy detected: ${sum}`);
                    cleanup();
                    resolve({ flowing: true, reason: 'flowing' });
                } else if (performance.now() - startTime > 3000) { // 3 seconds timeout
                    logger.log("Timeout waiting for audio energy. Data was all zeros.");
                    cleanup();
                    resolve({ flowing: false, reason: 'timeout' });
                } else {
                    requestAnimationFrame(check);
                }
            }
            
            function cleanup() {
                if (track) {
                    track.onended = null;
                    track.onmute = null;
                    track.onunmute = null;
                }
                source.disconnect();
                analyser.disconnect();
                audioContext.close();
            }
            
            requestAnimationFrame(check);
        } catch (e) {
            logger.log(`Failed to setup Web Audio verification: ${e.message}`);
            resolve({ flowing: false, reason: 'error', error: e.message });
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

/**
 * Queries available audio input devices and renders them as checkboxes.
 * Preserves selected state on refresh.
 */
async function enumerateAudioDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        deviceCheckboxesContainer.innerHTML = '<p class="error">enumerateDevices not supported</p>';
        return;
    }
    
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        
        // Store currently checked devices to restore them
        const checkedIds = new Set(
            Array.from(deviceCheckboxesContainer.querySelectorAll('input[type="checkbox"]:checked'))
                .map(cb => cb.value)
        );
        
        const isFirstLoad = deviceCheckboxesContainer.querySelector('input[type="checkbox"]') === null;
        
        deviceCheckboxesContainer.innerHTML = '';
        
        // Always add a "System Default" option
        const defaultChecked = isFirstLoad ? true : checkedIds.has('');
        addDeviceCheckbox('System Default', null, defaultChecked);
        
        audioInputs.forEach(device => {
            if (!device.deviceId || device.deviceId === 'default') return; // Skip empty and duplicate default
            
            const label = device.label || `Device (${truncateId(device.deviceId)})`;
            const checked = checkedIds.has(device.deviceId);
            addDeviceCheckbox(label, device.deviceId, checked);
        });
        
    } catch (err) {
        deviceCheckboxesContainer.innerHTML = `<p class="error">Error enumerating devices: ${err.message}</p>`;
    }
}

function addDeviceCheckbox(label, deviceId, checked) {
    const div = document.createElement('div');
    div.style.margin = '5px 0';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `dev-${deviceId || 'default'}`;
    checkbox.value = deviceId || '';
    checkbox.checked = checked;
    
    const labelEl = document.createElement('label');
    labelEl.htmlFor = checkbox.id;
    labelEl.style.marginLeft = '5px';
    labelEl.textContent = label;
    
    div.appendChild(checkbox);
    div.appendChild(labelEl);
    deviceCheckboxesContainer.appendChild(div);
}

function getSelectedDevices() {
    const checkboxes = deviceCheckboxesContainer.querySelectorAll('input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => ({
        id: cb.value || null, // null for default
        label: cb.nextSibling.textContent
    }));
}

/**
 * Main execution loop. Runs the full test suite sequentially for
 * each checked input device.
 */
async function runAllTests() {
    resultsContainer.innerHTML = '';
    runBtn.disabled = true;
    
    const selectedDevices = getSelectedDevices();
    if (selectedDevices.length === 0) {
        resultsContainer.innerHTML = '<p class="error" style="color: red; font-weight: bold;">Please select at least one device to test.</p>';
        runBtn.disabled = false;
        return;
    }
    
    for (const device of selectedDevices) {
        const deviceSection = document.createElement('div');
        deviceSection.className = 'device-group-section';
        deviceSection.style.marginTop = '20px';
        deviceSection.style.borderTop = '2px solid #333';
        deviceSection.style.paddingTop = '10px';
        
        const deviceHeader = document.createElement('h2');
        deviceHeader.textContent = `Testing Device: ${device.label}`;
        deviceHeader.style.margin = '0 0 10px 0';
        deviceSection.appendChild(deviceHeader);
        
        const deviceResultsContainer = document.createElement('div');
        deviceSection.appendChild(deviceResultsContainer);
        resultsContainer.appendChild(deviceSection);
        
        for (const test of tests) {
            const testEl = document.createElement('div');
            testEl.className = 'test-item';
            testEl.innerHTML = `
                <div class="test-header">
                    <span class="test-name">${test.name}</span>
                    <span class="test-status status-pending">PENDING</span>
                </div>
                <pre class="test-logs">Initializing...</pre>
                <div class="test-result-summary" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px solid #eee;">
                    <strong>Result:</strong> <span class="summary-text"></span><br>
                    <strong>Details:</strong> <span class="summary-details"></span>
                    <div class="bug-report-container" style="display: none; margin-top: 10px;">
                        <a href="#" target="_blank" class="bug-report-btn">🐞 Report Chromium Bug</a>
                    </div>
                </div>
            `;
            deviceResultsContainer.appendChild(testEl);
            
            const statusEl = testEl.querySelector('.test-status');
            const logsEl = testEl.querySelector('.test-logs');
            
            statusEl.className = 'test-status status-running';
            statusEl.textContent = 'RUNNING';
            
            const logger = new TestLogger(logsEl);
            
            const startTime = performance.now();
            const result = await test.run(logger, device.id);
            const duration = Math.round(performance.now() - startTime);
            
            statusEl.className = result.pass ? 'test-status status-pass' : 'test-status status-fail';
            statusEl.textContent = `${result.pass ? 'PASS' : 'FAIL'} (${duration}ms)`;
            
            // Show summary
            const summaryEl = testEl.querySelector('.test-result-summary');
            const summaryTextEl = testEl.querySelector('.summary-text');
            const summaryDetailsEl = testEl.querySelector('.summary-details');
            
            summaryTextEl.textContent = `${result.pass ? 'PASS' : 'FAIL'} (${duration}ms)`;
            summaryTextEl.style.color = result.pass ? '#155724' : '#721c24';
            summaryTextEl.style.fontWeight = 'bold';
            
            summaryDetailsEl.textContent = result.details || 'None';
            summaryEl.style.display = 'block';
            
            if (!result.pass) {
                const bugContainer = testEl.querySelector(".bug-report-container");
                const bugBtn = testEl.querySelector(".bug-report-btn");
                
                const browser = getBrowserInfo();
                const os = getOSInfo();
                
                let logStr = logger.logs.join("\n");
                if (logStr.length > 2000) {
                    logStr = logStr.slice(0, 2000) + "\n... (logs truncated for URL limit)";
                }
                
                const title = `[AudioCapture Test Failure] ${test.name} on ${browser.name} (${os})`;
                const desc = `### Test Failure Report\n\n` +
                             `- **Test Case:** \`${test.name}\`\n` +
                             `- **Device:** ${device.label} (ID: \`${device.id || "default"}\`)\n` +
                             `- **Browser:** ${browser.name} ${browser.version} (${os})\n` +
                             `- **User Agent:** \`${navigator.userAgent}\`\n\n` +
                             `#### Failure Details\n\`\`\`\n${result.details || "None"}\n\`\`\`\n\n` +
                             `#### Test Execution Logs\n\`\`\`\n${logStr}\n\`\`\``;
                
                const bugUrl = `https://g-issues.chromium.org/issues/new?component=1457016&template=1922563&format=MARKDOWN&title=${encodeURIComponent(title)}&description=${encodeURIComponent(desc)}`;
                bugBtn.href = bugUrl;
                bugContainer.style.display = "block";
            }
        }
    }
    
    runBtn.disabled = false;
    
    // Refresh devices to populate labels if permission was granted
    await enumerateAudioDevices();
}

function updateVerboseLogsVisibility() {
    if (verboseLogsCb.checked) {
        resultsContainer.classList.remove('hide-verbose-logs');
    } else {
        resultsContainer.classList.add('hide-verbose-logs');
    }
}

function getBrowserInfo() {
    const ua = navigator.userAgent;
    let tem;
    let M = ua.match(/(opera|chrome|safari|firefox|msie|trident(?=\/))\/?\s*(\d+)/i) || [];
    if (/trident/i.test(M[1])) {
        tem = /\brv[ :]+(\d+)/g.exec(ua) || [];
        return { name: 'IE', version: (tem[1] || '') };
    }
    if (M[1] === 'Chrome') {
        tem = ua.match(/\b(OPR|Edg)\/(\d+)/);
        if (tem != null) return { name: tem[1].replace('OPR', 'Opera'), version: tem[2] };
    }
    M = M[2] ? [M[1], M[2]] : [navigator.appName, navigator.appVersion, '-?'];
    if ((tem = ua.match(/version\/(\d+)/i)) != null) M.splice(1, 1, tem[1]);
    return {
        name: M[0],
        version: M[1]
    };
}

function getOSInfo() {
    const ua = navigator.userAgent;
    if (ua.indexOf("Win") !== -1) return "Windows";
    if (ua.indexOf("Mac") !== -1) return "MacOS";
    if (ua.indexOf("Linux") !== -1) return "Linux";
    if (ua.indexOf("Android") !== -1) return "Android";
    if (ua.indexOf("like Mac") !== -1) return "iOS";
    return "Unknown OS";
}

async function populateSystemInfo() {
    const infoDiv = document.getElementById('system-info-details');
    if (!infoDiv) return;
    
    const browser = getBrowserInfo();
    const os = getOSInfo();
    const isSecure = window.isSecureContext;
    const protocol = window.location.protocol;
    const host = window.location.hostname;
    
    const gumSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const audioContextSupported = !!(window.AudioContext || window.webkitAudioContext);
    const statsSupported = typeof MediaStreamTrack !== 'undefined' && ('stats' in MediaStreamTrack.prototype);
    
    let permissionStatus = 'Unknown';
    if (navigator.permissions && navigator.permissions.query) {
        try {
            const status = await navigator.permissions.query({ name: 'microphone' });
            permissionStatus = status.state; // 'granted', 'prompt', 'denied'
            
            // Auto-refresh when user updates permissions
            status.onchange = () => {
                populateSystemInfo();
                enumerateAudioDevices();
            };
        } catch (e) {
            permissionStatus = `Error: ${e.message}`;
        }
    }
    
    let permissionColor = 'orange';
    if (permissionStatus === 'granted') permissionColor = 'green';
    if (permissionStatus === 'denied') permissionColor = 'red';
    
    infoDiv.innerHTML = `
        <strong>Browser:</strong> ${browser.name} ${browser.version} (${os})<br>
        <strong>Secure Context:</strong> ${isSecure ? '<span style="color: green; font-weight:bold;">Yes</span>' : '<span style="color: red; font-weight:bold;">No (getUserMedia will fail)</span>'}<br>
        <strong>Microphone Permission:</strong> <span style="color: ${permissionColor}; font-weight:bold;">${permissionStatus}</span><br>
        <strong>Origin:</strong> ${protocol}//${host}<br>
        <strong>APIs Supported:</strong> 
        getUserMedia: ${gumSupported ? '✅' : '❌'}, 
        Web Audio: ${audioContextSupported ? '✅' : '❌'}, 
        Track Stats API: ${statsSupported ? '✅' : '❌ (fallback to Web Audio)'}<br>
        <details style="margin-top: 5px; cursor: pointer;">
            <summary style="font-size: 0.9em; color: #666;">Raw User Agent</summary>
            <pre style="margin: 5px 0 0 0; font-size: 0.85em; white-space: pre-wrap; background: #f1f3f5; padding: 5px; border-radius: 3px;">${navigator.userAgent}</pre>
        </details>
    `;
}

// Initialize
populateSystemInfo();
updateVerboseLogsVisibility();
verboseLogsCb.addEventListener('change', updateVerboseLogsVisibility);
enumerateAudioDevices();
refreshDevicesBtn.addEventListener('click', enumerateAudioDevices);
runBtn.addEventListener('click', runAllTests);

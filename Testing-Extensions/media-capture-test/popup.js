/**
 * popup.js for Media Capture Test Suite
 * Fully exercises all Chrome Media & Screen Capture APIs in InviSurf:
 * 1. chrome.desktopCapture.chooseDesktopMedia (Picker Modal with screens, windows, tabs)
 * 2. chrome.desktopCapture.cancelChooseDesktopMedia (Programmatic cancellation)
 * 3. chrome.tabCapture.getMediaStreamId + getUserMedia
 * 4. chrome.tabCapture.capture (Direct Tab Stream)
 * 5. chrome.tabCapture.getCapturedTabs (Active Tab Captures query)
 * 6. chrome.tabCapture.onStatusChanged (Real-time Status Events)
 * 7. navigator.mediaDevices.getDisplayMedia (Web standard via native picker)
 * 8. chrome.tabs.captureVisibleTab (Instant Tab Screenshot)
 */

let currentStream = null;
let activeTabId = null;
let pendingChooseMediaRequestId = null;

// DOM Elements
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const tabTitleEl = document.getElementById('tabTitle');
const tabIdBadge = document.getElementById('tabIdBadge');
const previewVideo = document.getElementById('previewVideo');
const previewPlaceholder = document.getElementById('previewPlaceholder');

const btnCaptureDesktop = document.getElementById('btnCaptureDesktop');
const btnCaptureStreamId = document.getElementById('btnCaptureStreamId');
const btnCaptureDirect = document.getElementById('btnCaptureDirect');
const btnGetDisplayMedia = document.getElementById('btnGetDisplayMedia');

const btnTestCancelPicker = document.getElementById('btnTestCancelPicker');
const btnGetCapturedTabs = document.getElementById('btnGetCapturedTabs');
const btnCaptureVisibleTab = document.getElementById('btnCaptureVisibleTab');
const btnSnapshot = document.getElementById('btnSnapshot');
const btnStop = document.getElementById('btnStop');
const btnClearLogs = document.getElementById('btnClearLogs');

const chkAudio = document.getElementById('chkAudio');
const chkVideo = document.getElementById('chkVideo');
const chkHighRes = document.getElementById('chkHighRes');

const metricApi = document.getElementById('metricApi');
const metricStreamId = document.getElementById('metricStreamId');
const metricVideoTrack = document.getElementById('metricVideoTrack');
const metricAudioTrack = document.getElementById('metricAudioTrack');
const metricCapturedCount = document.getElementById('metricCapturedCount');
const metricDrm = document.getElementById('metricDrm');

const snapshotContainer = document.getElementById('snapshotContainer');
const snapshotCanvas = document.getElementById('snapshotCanvas');
const snapshotImg = document.getElementById('snapshotImg');
const logConsole = document.getElementById('logConsole');

function log(msg, type = 'info') {
  const now = new Date().toTimeString().split(' ')[0];
  const div = document.createElement('div');
  div.className = `log-entry log-${type}`;
  div.textContent = `[${now}] ${msg}`;
  logConsole.appendChild(div);
  logConsole.scrollTop = logConsole.scrollHeight;
  console.log(`[MediaCaptureTest] ${msg}`);
}

// 1. Detect and display active tab
async function detectActiveTab() {
  try {
    if (chrome.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          log(`Tab query error: ${chrome.runtime.lastError.message}`, 'error');
          return;
        }
        if (tabs && tabs.length > 0) {
          const tab = tabs[0];
          activeTabId = tab.id;
          tabTitleEl.textContent = tab.title || tab.url || 'Active Tab';
          tabIdBadge.textContent = `Tab: ${tab.id}`;
          log(`Active tab detected: ID ${tab.id} ("${tab.title || tab.url}")`, 'info');
        } else {
          tabTitleEl.textContent = 'No active tab found';
          tabIdBadge.textContent = 'Tab: None';
          log('No active tab returned from chrome.tabs.query', 'warn');
        }
      });
    } else {
      tabTitleEl.textContent = 'chrome.tabs API unavailable';
      log('chrome.tabs API not present in window.chrome', 'error');
    }
  } catch (err) {
    log(`Failed to query tab: ${err.message}`, 'error');
  }
}

// 2. Set UI stream state
function setStreamingState(isStreaming, statusLabel = 'LIVE CAPTURE', badgeClass = 'live') {
  if (isStreaming) {
    statusBadge.className = `status-badge ${badgeClass}`;
    statusText.textContent = statusLabel;
    previewVideo.style.display = 'block';
    previewPlaceholder.style.display = 'none';
    btnStop.disabled = false;
    btnSnapshot.disabled = false;
  } else {
    statusBadge.className = 'status-badge';
    statusText.textContent = 'IDLE';
    previewVideo.style.display = 'none';
    previewPlaceholder.style.display = 'flex';
    btnStop.disabled = true;
    btnSnapshot.disabled = true;
    metricApi.textContent = 'None';
    metricStreamId.textContent = '-';
    metricVideoTrack.textContent = 'Inactive';
    metricAudioTrack.textContent = 'Inactive';
    metricDrm.textContent = 'Protected (Auto-managed)';
    metricDrm.style.color = '#34d399';
  }
}

// 3. Attach and play MediaStream
function attachStream(stream, apiName, streamId = 'native-stream') {
  if (currentStream) {
    stopAllTracks();
  }

  currentStream = stream;
  previewVideo.srcObject = stream;
  previewVideo.play().catch(err => log(`Autoplay warning: ${err.message}`, 'warn'));

  setStreamingState(true);

  metricApi.textContent = apiName;
  metricStreamId.textContent = streamId.length > 25 ? streamId.substring(0, 22) + '...' : streamId;

  const videoTracks = stream.getVideoTracks();
  const audioTracks = stream.getAudioTracks();

  if (videoTracks.length > 0) {
    const vt = videoTracks[0];
    const settings = vt.getSettings ? vt.getSettings() : {};
    const res = settings.width && settings.height ? `${settings.width}x${settings.height}` : 'Active';
    metricVideoTrack.textContent = `${res} (${vt.label || 'Video'})`;
    log(`Video Track active: ${vt.label || 'Default'} [${res}]`, 'success');
  } else {
    metricVideoTrack.textContent = 'None';
  }

  if (audioTracks.length > 0) {
    const at = audioTracks[0];
    metricAudioTrack.textContent = `Active (${at.label || 'Audio'})`;
    log(`Audio Track active: ${at.label || 'Audio stream'}`, 'success');
  } else {
    metricAudioTrack.textContent = 'None';
  }

  metricDrm.textContent = 'Suspended (Safe Capture Active)';
  metricDrm.style.color = '#fbbf24';

  // Monitor tracks for ending
  stream.getTracks().forEach((t) => {
    t.onended = () => {
      log(`Track ended: ${t.kind} (${t.label})`, 'info');
      if (stream.getTracks().every(tr => tr.readyState === 'ended')) {
        stopAllTracks();
      }
    };
  });
}

// 4. Stop stream
function stopAllTracks() {
  if (currentStream) {
    currentStream.getTracks().forEach(t => {
      try {
        t.stop();
        log(`Stopped ${t.kind} track`, 'info');
      } catch (_) {}
    });
    currentStream = null;
  }
  if (previewVideo.srcObject) {
    previewVideo.srcObject = null;
  }
  setStreamingState(false);
  log('Capture stopped and DRM protections restored.', 'success');
  refreshCapturedTabs();
}

// =========================================================================
// API Test 1: chrome.desktopCapture.chooseDesktopMedia (Picker Modal)
// =========================================================================
async function testDesktopCapturePicker() {
  if (!chrome.desktopCapture?.chooseDesktopMedia) {
    log('chrome.desktopCapture.chooseDesktopMedia is not available', 'error');
    return;
  }

  const sources = ['screen', 'window', 'tab'];
  if (chkAudio.checked) sources.push('audio');

  log('Opening chrome.desktopCapture interactive picker modal...', 'info');
  statusBadge.className = 'status-badge pending';
  statusText.textContent = 'PICKER OPEN';

  pendingChooseMediaRequestId = chrome.desktopCapture.chooseDesktopMedia(sources, async (streamId, options) => {
    pendingChooseMediaRequestId = null;

    if (chrome.runtime.lastError) {
      log(`chooseDesktopMedia error: ${chrome.runtime.lastError.message}`, 'error');
      setStreamingState(false);
      return;
    }

    if (!streamId) {
      log('User cancelled desktop media picker dialog', 'warn');
      setStreamingState(false);
      return;
    }

    log(`Picker selected streamId: ${streamId} (audioTrackAllowed: ${options?.canRequestAudioTrack ?? true})`, 'success');

    const wantAudio = chkAudio.checked && (options?.canRequestAudioTrack !== false);
    const wantVideo = chkVideo.checked;
    const is1080p = chkHighRes.checked;

    const constraints = {
      audio: wantAudio ? {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId,
        }
      } : false,
      video: wantVideo ? {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId,
          maxWidth: is1080p ? 1920 : 1280,
          maxHeight: is1080p ? 1080 : 720,
        }
      } : false,
    };

    try {
      log('Invoking navigator.mediaDevices.getUserMedia with streamId...', 'info');
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      attachStream(stream, 'desktopCapture (Modal)', streamId);
      refreshCapturedTabs();
    } catch (err) {
      log(`getUserMedia failed (${err.name}: ${err.message})`, 'error');
      setStreamingState(false);
    }
  });

  log(`chooseDesktopMedia request spawned with ID: ${pendingChooseMediaRequestId}`, 'info');
}

// =========================================================================
// API Test 2: chrome.desktopCapture.cancelChooseDesktopMedia
// =========================================================================
function testCancelPickerProgrammatically() {
  if (!chrome.desktopCapture?.chooseDesktopMedia || !chrome.desktopCapture?.cancelChooseDesktopMedia) {
    log('desktopCapture cancellation APIs not available', 'error');
    return;
  }

  log('Spawning picker and scheduling auto-cancellation in 2.5 seconds...', 'info');
  statusBadge.className = 'status-badge pending';
  statusText.textContent = 'AUTO-CANCEL TEST';

  const reqId = chrome.desktopCapture.chooseDesktopMedia(['screen', 'window', 'tab'], (streamId) => {
    if (!streamId) {
      log(`Picker successfully auto-cancelled (Request ID: ${reqId})!`, 'success');
    } else {
      log(`Picker resolved with streamId: ${streamId}`, 'info');
    }
    setStreamingState(false);
  });

  setTimeout(() => {
    log(`Triggering chrome.desktopCapture.cancelChooseDesktopMedia(${reqId})...`, 'warn');
    chrome.desktopCapture.cancelChooseDesktopMedia(reqId);
  }, 2500);
}

// =========================================================================
// API Test 3: chrome.tabCapture.getMediaStreamId + getUserMedia
// =========================================================================
async function testTabCaptureStreamId() {
  if (!chrome.tabCapture?.getMediaStreamId) {
    log('chrome.tabCapture.getMediaStreamId is not available', 'error');
    return;
  }

  log(`Requesting tab stream ID for Tab ${activeTabId || 'current'}...`, 'info');

  chrome.tabCapture.getMediaStreamId({ targetTabId: activeTabId }, async (streamId) => {
    if (chrome.runtime.lastError) {
      log(`getMediaStreamId error: ${chrome.runtime.lastError.message}`, 'error');
      return;
    }
    if (!streamId) {
      log('getMediaStreamId returned empty streamId', 'error');
      return;
    }

    log(`Acquired streamId: ${streamId}`, 'success');

    const wantAudio = chkAudio.checked;
    const wantVideo = chkVideo.checked;
    const is1080p = chkHighRes.checked;

    const constraints = {
      audio: wantAudio ? {
        mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId }
      } : false,
      video: wantVideo ? {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId,
          maxWidth: is1080p ? 1920 : 1280,
          maxHeight: is1080p ? 1080 : 720,
        }
      } : false,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      attachStream(stream, 'tabCapture.getMediaStreamId', streamId);
      refreshCapturedTabs();
    } catch (err) {
      log(`getUserMedia failed for tab stream: ${err.name} - ${err.message}`, 'error');
    }
  });
}

// =========================================================================
// API Test 4: chrome.tabCapture.capture (Direct API)
// =========================================================================
function testTabCaptureDirect() {
  if (!chrome.tabCapture?.capture) {
    log('chrome.tabCapture.capture is not available', 'error');
    return;
  }

  const opt = {
    audio: chkAudio.checked,
    video: chkVideo.checked,
  };

  log('Calling chrome.tabCapture.capture...', 'info');
  chrome.tabCapture.capture(opt, (stream) => {
    if (chrome.runtime.lastError || !stream) {
      log(`chrome.tabCapture.capture returned error or null: ${chrome.runtime.lastError?.message || 'null'}`, 'error');
      return;
    }
    attachStream(stream, 'tabCapture.capture');
    refreshCapturedTabs();
  });
}

// =========================================================================
// API Test 5: navigator.mediaDevices.getDisplayMedia (Web Standard)
// =========================================================================
async function testGetDisplayMedia() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    log('navigator.mediaDevices.getDisplayMedia is not supported in this context', 'error');
    return;
  }

  log('Invoking navigator.mediaDevices.getDisplayMedia (triggers native picker)...', 'info');

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: chkHighRes.checked ? 1920 : 1280,
        height: chkHighRes.checked ? 1080 : 720,
      },
      audio: chkAudio.checked,
    });
    attachStream(stream, 'getDisplayMedia (Web API)');
    refreshCapturedTabs();
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      log('User cancelled getDisplayMedia selection', 'warn');
    } else {
      log(`getDisplayMedia error: ${err.name} - ${err.message}`, 'error');
    }
  }
}

// =========================================================================
// API Test 6: chrome.tabCapture.getCapturedTabs
// =========================================================================
function refreshCapturedTabs() {
  if (!chrome.tabCapture?.getCapturedTabs) return;

  chrome.tabCapture.getCapturedTabs((tabs) => {
    if (chrome.runtime.lastError) {
      log(`getCapturedTabs error: ${chrome.runtime.lastError.message}`, 'error');
      return;
    }

    const count = Array.isArray(tabs) ? tabs.length : 0;
    metricCapturedCount.textContent = String(count);

    if (count > 0) {
      log(`getCapturedTabs returned ${count} active session(s): ${JSON.stringify(tabs)}`, 'info');
    }
  });
}

// =========================================================================
// API Test 7: chrome.tabs.captureVisibleTab (Instant Snapshot)
// =========================================================================
function testCaptureVisibleTab() {
  if (!chrome.tabs?.captureVisibleTab) {
    log('chrome.tabs.captureVisibleTab is not available', 'error');
    return;
  }

  log('Taking tab snapshot via chrome.tabs.captureVisibleTab...', 'info');

  chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      log(`captureVisibleTab error: ${chrome.runtime.lastError.message}`, 'error');
      return;
    }
    if (!dataUrl) {
      log('captureVisibleTab returned empty image', 'error');
      return;
    }

    snapshotCanvas.style.display = 'none';
    snapshotImg.style.display = 'block';
    snapshotImg.src = dataUrl;
    snapshotContainer.style.display = 'block';

    log('Tab snapshot captured and displayed below.', 'success');
  });
}

// =========================================================================
// API Test 8: Live Video Frame Snapshot
// =========================================================================
function takeVideoFrameSnapshot() {
  if (!currentStream || !previewVideo.videoWidth) {
    log('Cannot take snapshot: no active video frame', 'error');
    return;
  }

  const w = previewVideo.videoWidth;
  const h = previewVideo.videoHeight;
  snapshotCanvas.width = w;
  snapshotCanvas.height = h;

  const ctx = snapshotCanvas.getContext('2d');
  ctx.drawImage(previewVideo, 0, 0, w, h);

  snapshotImg.style.display = 'none';
  snapshotCanvas.style.display = 'block';
  snapshotContainer.style.display = 'block';

  log(`Video frame snapshot captured (${w}x${h}px).`, 'success');
}

// =========================================================================
// Event Listeners & Status Listeners
// =========================================================================
btnCaptureDesktop.addEventListener('click', testDesktopCapturePicker);
btnCaptureStreamId.addEventListener('click', testTabCaptureStreamId);
btnCaptureDirect.addEventListener('click', testTabCaptureDirect);
btnGetDisplayMedia.addEventListener('click', testGetDisplayMedia);

btnTestCancelPicker.addEventListener('click', testCancelPickerProgrammatically);
btnGetCapturedTabs.addEventListener('click', refreshCapturedTabs);
btnCaptureVisibleTab.addEventListener('click', testCaptureVisibleTab);
btnSnapshot.addEventListener('click', takeVideoFrameSnapshot);
btnStop.addEventListener('click', stopAllTracks);

btnClearLogs.addEventListener('click', () => {
  logConsole.innerHTML = '';
  snapshotContainer.style.display = 'none';
});

// Subscribe to chrome.tabCapture.onStatusChanged
if (chrome.tabCapture?.onStatusChanged) {
  try {
    chrome.tabCapture.onStatusChanged.addListener((info) => {
      log(`[Event] tabCapture.onStatusChanged -> Tab ${info.tabId}: "${info.status}"`, 'info');
      refreshCapturedTabs();
    });
    log('Subscribed to chrome.tabCapture.onStatusChanged events.', 'info');
  } catch (err) {
    log(`Failed to subscribe to onStatusChanged: ${err.message}`, 'warn');
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  log('Media Capture Test Suite loaded.', 'info');
  detectActiveTab();
  refreshCapturedTabs();
});

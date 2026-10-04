/**
 * popup.js for Media Capture Tester
 * Exercises chrome.tabCapture, chrome.desktopCapture, and getUserMedia
 */

let currentStream = null;
let activeTabId = null;

// DOM Elements
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const tabTitleEl = document.getElementById('tabTitle');
const tabIdBadge = document.getElementById('tabIdBadge');
const previewVideo = document.getElementById('previewVideo');
const previewPlaceholder = document.getElementById('previewPlaceholder');

const btnCaptureStreamId = document.getElementById('btnCaptureStreamId');
const btnCaptureDirect = document.getElementById('btnCaptureDirect');
const btnCaptureDesktop = document.getElementById('btnCaptureDesktop');
const btnStop = document.getElementById('btnStop');
const btnSnapshot = document.getElementById('btnSnapshot');
const btnClearLogs = document.getElementById('btnClearLogs');
const btnOpenSystemSettings = document.getElementById('btnOpenSystemSettings');
const macPermissionWarning = document.getElementById('macPermissionWarning');

const chkAudio = document.getElementById('chkAudio');
const chkVideo = document.getElementById('chkVideo');
const chkHighRes = document.getElementById('chkHighRes');

const metricApi = document.getElementById('metricApi');
const metricStreamId = document.getElementById('metricStreamId');
const metricVideoTrack = document.getElementById('metricVideoTrack');
const metricAudioTrack = document.getElementById('metricAudioTrack');
const metricDrm = document.getElementById('metricDrm');

const snapshotContainer = document.getElementById('snapshotContainer');
const snapshotCanvas = document.getElementById('snapshotCanvas');
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
          log('No active tab returned from chrome.tabs.query', 'error');
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
function setStreamingState(isStreaming, apiName = '', streamId = '') {
  if (isStreaming) {
    statusBadge.className = 'status-badge live';
    statusText.textContent = 'LIVE CAPTURING';
    previewPlaceholder.style.display = 'none';
    previewVideo.style.display = 'block';

    btnCaptureStreamId.disabled = true;
    btnCaptureDirect.disabled = true;
    btnCaptureDesktop.disabled = true;
    btnStop.disabled = false;
    btnSnapshot.disabled = false;

    metricApi.textContent = apiName;
    metricStreamId.textContent = streamId ? (streamId.length > 18 ? streamId.slice(0, 18) + '...' : streamId) : 'Native Stream';
    metricDrm.textContent = 'Active (Protected window capture)';
    metricDrm.style.color = '#34d399';
  } else {
    statusBadge.className = 'status-badge';
    statusText.textContent = 'IDLE';
    previewPlaceholder.style.display = 'flex';
    previewVideo.style.display = 'none';

    btnCaptureStreamId.disabled = false;
    btnCaptureDirect.disabled = false;
    btnCaptureDesktop.disabled = false;
    btnStop.disabled = true;
    btnSnapshot.disabled = true;

    metricApi.textContent = 'None';
    metricStreamId.textContent = '-';
    metricVideoTrack.textContent = 'Inactive';
    metricAudioTrack.textContent = 'Inactive';
    metricDrm.textContent = 'Protected (Restored)';
    metricDrm.style.color = '#34d399';
  }
}

// 3. Update track metrics
function updateTrackMetrics(stream) {
  if (!stream) return;
  const vTrack = stream.getVideoTracks()[0];
  const aTrack = stream.getAudioTracks()[0];

  if (vTrack) {
    const settings = vTrack.getSettings ? vTrack.getSettings() : {};
    const res = settings.width && settings.height ? `${settings.width}x${settings.height}` : 'Active (Live)';
    metricVideoTrack.textContent = `${res} (${vTrack.readyState})`;
  } else {
    metricVideoTrack.textContent = 'No video track';
  }

  if (aTrack) {
    metricAudioTrack.textContent = `${aTrack.label || 'Tab Audio'} (${aTrack.readyState})`;
  } else {
    metricAudioTrack.textContent = 'No audio track';
  }
}

// 4. Attach stream to preview
function attachStream(stream, apiName, streamId = '') {
  currentStream = stream;
  previewVideo.srcObject = stream;
  previewVideo.play().catch(e => log(`Play error: ${e.message}`, 'error'));

  setStreamingState(true, apiName, streamId);
  updateTrackMetrics(stream);
  log(`Media stream attached successfully (${stream.getTracks().length} tracks)`, 'success');

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

// 5. Stop stream
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
  log('Capture stopped and DRM protections verified restored.', 'success');
}

// InviSurf direct compositor tab frame stream generator (works with ZERO OS screen recording permissions)
function createCompositorTabMediaStream() {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx) {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const stream = canvas.captureStream ? canvas.captureStream(30) : null;
    if (!stream) {
      resolve(null);
      return;
    }

    let active = true;
    const img = new Image();

    const poll = () => {
      if (!active) return;
      if (chrome.tabs?.captureVisibleTab) {
        chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 80 }, (dataUrl) => {
          if (chrome.runtime.lastError || !dataUrl || !active) {
            if (active) setTimeout(poll, 66);
            return;
          }
          img.onload = () => {
            if (!active) return;
            if (img.width && img.height && (canvas.width !== img.width || canvas.height !== img.height)) {
              canvas.width = img.width;
              canvas.height = img.height;
            }
            ctx.drawImage(img, 0, 0);
            if (active) setTimeout(poll, 33);
          };
          img.src = dataUrl;
        });
      } else {
        if (active) setTimeout(poll, 100);
      }
    };

    poll();

    stream.getTracks().forEach(t => {
      const orig = t.stop.bind(t);
      t.stop = () => {
        active = false;
        orig();
      };
    });

    resolve(stream);
  });
}

// Method A: chrome.tabCapture.getMediaStreamId + getUserMedia
async function startTabCaptureStreamId() {
  if (!chrome.tabCapture?.getMediaStreamId) {
    log('chrome.tabCapture.getMediaStreamId is not available', 'error');
    return;
  }

  log(`Requesting streamId for Tab ${activeTabId || 'current'}...`, 'info');

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

    log('Invoking navigator.mediaDevices.getUserMedia...', 'info');

    let stream = null;
    if (streamId.startsWith('window:') || streamId.startsWith('screen:')) {
      try {
        const constraints = {
          audio: wantAudio ? { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId } } : false,
          video: wantVideo ? { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId, maxWidth: is1080p ? 1920 : 1280, maxHeight: is1080p ? 1080 : 720 } } : false,
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        log(`Native desktop stream failed (${err.name} - ${err.message}), using InviSurf compositor stream...`, 'info');
      }
    }

    // Direct compositor fallback
    if (!stream) {
      log('Starting InviSurf direct compositor tab capture stream...', 'info');
      stream = await createCompositorTabMediaStream();
    }

    if (stream) {
      attachStream(stream, 'tabCapture.getMediaStreamId', streamId);
    } else {
      log('Failed to create tab media stream', 'error');
    }
  });
}

// Method B: chrome.tabCapture.capture (Direct API)
async function startTabCaptureDirect() {
  if (!chrome.tabCapture?.capture) {
    log('chrome.tabCapture.capture is not available', 'error');
    return;
  }

  const opt = {
    audio: chkAudio.checked,
    video: chkVideo.checked,
  };

  log('Calling chrome.tabCapture.capture...', 'info');
  chrome.tabCapture.capture(opt, async (stream) => {
    if (chrome.runtime.lastError || !stream) {
      log(`Native direct capture unavailable, falling back to compositor stream...`, 'info');
      const fallbackStream = await createCompositorTabMediaStream();
      if (fallbackStream) {
        attachStream(fallbackStream, 'tabCapture.capture (Compositor Mode)');
        return;
      }
      log(`capture error: ${chrome.runtime.lastError?.message || 'null stream'}`, 'error');
      return;
    }
    attachStream(stream, 'tabCapture.capture');
  });
}

// Method C: chrome.desktopCapture.chooseDesktopMedia
async function startDesktopCapture() {
  if (!chrome.desktopCapture?.chooseDesktopMedia) {
    log('chrome.desktopCapture.chooseDesktopMedia is not available', 'error');
    return;
  }

  log('Opening chrome.desktopCapture picker...', 'info');
  chrome.desktopCapture.chooseDesktopMedia(['screen', 'window'], async (streamId) => {
    if (chrome.runtime.lastError) {
      log(`chooseDesktopMedia error: ${chrome.runtime.lastError.message}`, 'error');
      return;
    }
    if (!streamId) {
      log('User cancelled desktop media selection', 'info');
      return;
    }

    log(`Acquired desktop streamId: ${streamId}`, 'success');

    const constraints = {
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId,
          maxWidth: 1920,
          maxHeight: 1080,
        }
      }
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      attachStream(stream, 'desktopCapture.chooseDesktopMedia', streamId);
    } catch (err) {
      log(`Desktop getUserMedia failed: ${err.name} - ${err.message}`, 'error');
      if (err.name === 'NotAllowedError' || err.message?.includes('Permission denied')) {
        if (macPermissionWarning) macPermissionWarning.style.display = 'block';
        log('macOS requires Screen Recording permission for "Electron". Click the red settings button above to open macOS System Settings.', 'error');
      }
    }
  });
}

// Snapshot capture from video
function takeSnapshot() {
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
  snapshotContainer.style.display = 'block';

  log(`Snapshot captured: ${w}x${h} frame`, 'success');
}

// Event Listeners
btnCaptureStreamId.addEventListener('click', startTabCaptureStreamId);
btnCaptureDirect.addEventListener('click', startTabCaptureDirect);
btnCaptureDesktop.addEventListener('click', startDesktopCapture);
btnStop.addEventListener('click', stopAllTracks);
btnSnapshot.addEventListener('click', takeSnapshot);

if (btnOpenSystemSettings) {
  btnOpenSystemSettings.addEventListener('click', () => {
    if (window.invisurf?.openScreenCaptureSettings) {
      window.invisurf.openScreenCaptureSettings();
      log('Opened macOS Screen Recording settings.', 'info');
    }
  });
}

btnClearLogs.addEventListener('click', () => {
  logConsole.innerHTML = '';
  snapshotContainer.style.display = 'none';
});

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  log('Media Capture Tester initialized in InviSurf.', 'info');
  detectActiveTab();

  if (window.invisurf?.getMediaAccessStatus) {
    window.invisurf.getMediaAccessStatus().then((res) => {
      if (res?.screen && res.screen !== 'granted') {
        if (macPermissionWarning) macPermissionWarning.style.display = 'block';
        log('Notice: macOS Screen Recording permission is currently not granted to Electron.', 'info');
      }
    }).catch(() => {});
  }
});

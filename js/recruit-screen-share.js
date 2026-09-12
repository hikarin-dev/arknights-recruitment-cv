/* Sample the selected window locally. Only stable, changed tag grids reach OCR. */
window.RecruitScreenShare = function ({ button, onRequest, onStart, onFrame, onMissing, onStop, onStatus }) {
  let session = 0, state = 'idle', stream, video, timer, frameCallback;
  let pending, accepted, lastAttempt = 0, missing = false;
  let missingFrames = 0;
  let samplingSession, wakeRequested = false, lastCheck = 0, lastDetection = 0, confirming = false;
  let probeGrid, probePrevious, probeAnchor, transitionAway = false;
  const CHECK_INTERVAL = 100, FALLBACK_INTERVAL = 250, SETTLE_INTERVAL = 150, RESCAN_INTERVAL = 1000;
  const frame = document.createElement('canvas');
  const preview = document.createElement('canvas');
  const probeCanvas = document.createElement('canvas');
  probeCanvas.width = 16 * 5; probeCanvas.height = 8;
  const signatureCanvas = document.createElement('canvas');
  signatureCanvas.width = 128; signatureCanvas.height = 40;

  function stop() {
    const wasActive = state !== 'idle';
    session++;
    state = 'idle';
    cancelScheduled();
    if (stream) stream.getTracks().forEach(track => track.stop());
    if (video) { video.pause(); video.srcObject = null; }
    stream = video = undefined;
    pending = accepted = undefined;
    probeGrid = probePrevious = probeAnchor = undefined;
    transitionAway = confirming = wakeRequested = false;
    button.setAttribute('aria-pressed', 'false');
    button.textContent = 'Screen share';
    if (wasActive) onStop();
  }

  function cancelScheduled() {
    clearTimeout(timer);
    if (frameCallback !== undefined) video?.cancelVideoFrameCallback(frameCallback);
    frameCallback = undefined;
  }

  function schedule(token) {
    // Fresh video frames drive the cheap checks. A timer also covers still frames,
    // suspended video callbacks and browsers without requestVideoFrameCallback.
    const watchFrame = () => {
      if (!video?.requestVideoFrameCallback) return;
      frameCallback = video.requestVideoFrameCallback(() => {
        frameCallback = undefined;
        if (token !== session || state !== 'active') return;
        if (performance.now() - lastCheck >= CHECK_INTERVAL) sample(token);
        else watchFrame();
      });
    };
    watchFrame();
    timer = setTimeout(() => sample(token), FALLBACK_INTERVAL);
  }

  function wake() {
    if (state === 'active') sample(session, true);
  }

  function readProbe(source) {
    const ctx = probeCanvas.getContext('2d', { willReadFrequently: true });
    probeGrid.boxes.forEach((box, i) => {
      ctx.drawImage(source, box.x, box.y, box.width, box.height, i * 16, 0, 16, 8);
    });
    return ctx.getImageData(0, 0, 80, 8).data;
  }

  function changedButtons(a, b, threshold) {
    if (!a || !b) return 5;
    let changed = 0;
    for (let tag = 0; tag < 5; tag++) {
      let difference = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) {
        const i = (y * 80 + tag * 16 + x) * 4;
        for (let channel = 0; channel < 3; channel++) difference += Math.abs(a[i + channel] - b[i + channel]);
      }
      if (difference / (16 * 8 * 3) > threshold) changed++;
    }
    return changed;
  }

  function fingerprint(boxes) {
    const ctx = signatureCanvas.getContext('2d', { willReadFrequently: true });
    const pixels = new Uint8Array(128 * 40 * 5);
    boxes.forEach((box, index) => {
      ctx.drawImage(preview, box.x + box.width * 0.04, box.y + box.height * 0.12,
        box.width * 0.92, box.height * 0.76, 0, 0, 128, 40);
      const data = ctx.getImageData(0, 0, 128, 40).data;
      for (let i = 0; i < 128 * 40; i++) {
        pixels[index * 128 * 40 + i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114 > 175 ? 1 : 0;
      }
    });
    return { pixels, boxes, width: frame.width, height: frame.height, observedAt: lastCheck };
  }

  function same(a, b) {
    if (!a || !b || a.width !== b.width || a.height !== b.height) return false;
    if (a.boxes.some((box, i) => ['x', 'y', 'width', 'height'].some(key => Math.abs(box[key] - b.boxes[i][key]) > 2))) return false;
    // Compare each button separately so a single changed short tag isn't diluted.
    for (let tag = 0; tag < 5; tag++) {
      let changed = 0;
      for (let i = tag * 5120; i < (tag + 1) * 5120; i++) changed += a.pixels[i] !== b.pixels[i];
      if (changed / 5120 > 0.015) return false;
    }
    return true;
  }

  function markMissing(text) {
    if (++missingFrames < 3) return;
    if (!missing) {
      pending = accepted = undefined;
      missing = true;
      onMissing(text + ' Your previous screenshot is kept until different tags are confirmed.');
    }
  }

  async function sample(token, force = false) {
    if (token !== session || state !== 'active') return;
    // Focus/visibility events can arrive together, including during an OCR job.
    if (samplingSession === token) { wakeRequested ||= force; return; }
    cancelScheduled();
    samplingSession = token;
    lastCheck = performance.now();
    try {
      if (stream.getVideoTracks()[0]?.muted || video.readyState < 2 || !video.videoWidth) {
        markMissing('Waiting for the game window. Keep it open so its tags can be read.');
        return;
      }
      let changed = true;
      if (probeGrid?.width === video.videoWidth && probeGrid?.height === video.videoHeight) {
        // Just 640 pixels across the five known buttons; no full-size canvas copy,
        // connected-component detection or OCR is needed for this fast path.
        const colors = readProbe(video);
        changed = changedButtons(colors, probePrevious, 6) > 0;
        if (probeAnchor && changedButtons(colors, probeAnchor, 20) === 5) transitionAway = true;
        if (transitionAway && changedButtons(colors, probeAnchor, 6) === 0) {
          // All buttons disappeared/changed color and returned: validate again even
          // if the fine fingerprint looks familiar. The tag-ID check still owns UI updates.
          transitionAway = false;
          pending = accepted = undefined;
          lastAttempt = 0;
          force = true;
        }
        // Keep the last full scan as the reference so small changes can accumulate.
        const elapsed = lastCheck - lastDetection;
        if (!force && elapsed < RESCAN_INTERVAL && (!(changed || confirming) || elapsed < SETTLE_INTERVAL)) return;
      } else {
        probeGrid = probePrevious = probeAnchor = undefined;
        transitionAway = false;
        if (!force && lastCheck - lastDetection < FALLBACK_INTERVAL) return;
      }
      lastDetection = lastCheck;
      frame.width = video.videoWidth; frame.height = video.videoHeight;
      frame.getContext('2d').drawImage(video, 0, 0);
      const scale = Math.min(1, 1280 / frame.width);
      preview.width = Math.round(frame.width * scale); preview.height = Math.round(frame.height * scale);
      const ctx = preview.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(frame, 0, 0, preview.width, preview.height);
      const boxes = RecruitVision.detectButtons(ctx.getImageData(0, 0, preview.width, preview.height));
      if (boxes.length !== 5) {
        confirming = false;
        if (probeGrid) probePrevious = readProbe(frame);
        markMissing('Open the recruitment screen in the shared game window. I’ll read the five tags automatically.');
        return;
      }
      probeGrid = { width: frame.width, height: frame.height, boxes: boxes.map(box => ({
        x: box.x * frame.width / preview.width, y: box.y * frame.height / preview.height,
        width: box.width * frame.width / preview.width, height: box.height * frame.height / preview.height,
      })) };
      probePrevious = readProbe(frame);
      probeAnchor ||= probePrevious;
      missing = false; missingFrames = 0;
      const current = fingerprint(boxes);
      if (same(current, accepted)) { confirming = false; return; }
      if (!same(current, pending)) {
        pending = current;
        lastAttempt = 0;
        confirming = true;
        return;
      }
      // Duplicate focus events must not count as time for a grid to settle.
      if (confirming && lastCheck - pending.observedAt < SETTLE_INTERVAL) return;
      confirming = false;
      if (Date.now() - lastAttempt < 5000) return;
      lastAttempt = Date.now();
      const blob = await new Promise(resolve => frame.toBlob(resolve, 'image/png'));
      if (token !== session || !blob) return;
      const success = await onFrame(blob);
      if (token === session && success) {
        accepted = current;
        probeAnchor = probePrevious;
        transitionAway = false;
      }
    } catch {
      if (token === session) {
        stop();
        onStatus('The shared window could not be read. Turn Screen share on to try again.');
      }
    } finally {
      // Await each OCR job: frames cannot build up a queue while recognition runs.
      if (samplingSession === token) samplingSession = undefined;
      if (token === session && state === 'active') {
        if (wakeRequested) { wakeRequested = false; sample(token, true); }
        else schedule(token);
      }
    }
  }

  async function start() {
    if (!navigator.mediaDevices?.getDisplayMedia || !window.isSecureContext) {
      onStatus('Screen sharing is not available here. Try Chrome or Edge on localhost or HTTPS, or paste a screenshot.');
      return;
    }
    const token = ++session;
    state = 'starting';
    button.setAttribute('aria-pressed', 'true');
    button.textContent = 'Cancel sharing';
    onStatus('Choose Window, then Arknights, and click Share. Your browser requires you to make this selection.');
    try {
      // Invoke directly from the click gesture. The browser always owns the picker.
      const selection = navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'window', frameRate: { ideal: 10, max: 10 } },
        audio: false,
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'exclude',
      });
      onRequest();
      const selected = await selection;
      if (token !== session) { selected.getTracks().forEach(track => track.stop()); return; }
      stream = selected;
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') throw new Error('No live video track');
      video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.srcObject = stream;
      track.addEventListener('ended', () => { if (token === session) stop(); }, { once: true });
      track.addEventListener('unmute', () => { if (token === session) wake(); });
      await video.play();
      if (token !== session) return;
      state = 'active';
      missing = false; missingFrames = 0; pending = accepted = undefined; lastAttempt = 0;
      lastCheck = lastDetection = -Infinity;
      confirming = wakeRequested = transitionAway = false;
      probeGrid = probePrevious = probeAnchor = undefined;
      button.textContent = 'Stop sharing';
      onStart();
      onStatus('Screen share is on. Open the recruitment screen in the game and I’ll read its tags automatically.');
      sample(token);
    } catch (error) {
      if (token !== session) return;
      stop();
      onStatus(error.name === 'NotAllowedError'
        ? 'Screen sharing wasn’t started. Click Screen share to choose a window, or paste a screenshot.'
        : 'Could not start screen sharing. Check that the game window is open and try again.');
    }
  }

  button.addEventListener('click', () => { if (state === 'idle') start(); else stop(); });
  window.addEventListener('focus', wake);
  window.addEventListener('blur', wake);
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('pagehide', stop);
  return { stop, get active() { return state !== 'idle'; } };
};

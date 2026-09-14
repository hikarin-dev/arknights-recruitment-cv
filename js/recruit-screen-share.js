/* Track button text continuously; periodically verify even apparently unchanged grids. */
window.RecruitScreenShare = function ({ button, onRequest, onStart, onFrame, onMissing, onStop, onStatus }) {
  const CHECK_INTERVAL = 50, FALLBACK_INTERVAL = 80, SETTLE_INTERVAL = 100, RESCAN_INTERVAL = 750;
  const VERIFY_INTERVAL = 750, WAKE_VERIFY_INTERVAL = 250, WAKE_DURATION = 1500;
  let session = 0, state = 'idle', stream, video, timer, frameCallback;
  let grid, pending, accepted, inFlight, revision = 0;
  let lastCheck = -Infinity, lastDetection = -Infinity, retryAt = 0, failures = 0;
  let verifyAt = 0, wakeUntil = 0;
  let manualRefresh = false;
  let missingSince, missingReported = false;
  const preview = document.createElement('canvas');
  const signatureCanvas = document.createElement('canvas');
  signatureCanvas.width = 128 * 5; signatureCanvas.height = 40;

  function cancelScheduled() {
    clearTimeout(timer);
    if (frameCallback !== undefined) video?.cancelVideoFrameCallback(frameCallback);
    frameCallback = undefined;
  }

  function stop() {
    const wasActive = state !== 'idle';
    session++; revision++;
    state = 'idle';
    cancelScheduled();
    if (stream) stream.getTracks().forEach(track => track.stop());
    if (video) { video.pause(); video.srcObject = null; }
    stream = video = grid = pending = accepted = inFlight = undefined;
    manualRefresh = false;
    button.setAttribute('aria-pressed', 'false');
    button.textContent = 'Screen share';
    if (wasActive) onStop();
  }

  function schedule(token) {
    // Timers cover still frames and unavailable/throttled video callbacks.
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
    if (state !== 'active') return;
    // The first frame after focus/unmute can still be the old frame. Keep
    // verifying briefly afterwards, even if the pixel comparison sees no change.
    wakeUntil = performance.now() + WAKE_DURATION;
    verifyAt = retryAt = 0;
    sample(session, true);
  }

  function refresh() {
    if (state !== 'active') return;
    // Invalidate any older OCR result, then read the latest stable frame from
    // scratch. Repeated clicks coalesce into one request behind the active job.
    revision++;
    manualRefresh = true;
    grid = pending = accepted = undefined;
    lastDetection = -Infinity;
    failures = 0;
    onStatus('Checking the shared window again…');
    wake();
  }

  function locate() {
    // Downsample directly, without first copying or encoding a full-size image.
    const width = Math.min(1280, video.videoWidth);
    const height = Math.round(video.videoHeight * width / video.videoWidth);
    if (preview.width !== width || preview.height !== height) { preview.width = width; preview.height = height; }
    const ctx = preview.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(video, 0, 0, width, height);
    const boxes = RecruitVision.detectButtons(ctx.getImageData(0, 0, width, height));
    lastDetection = performance.now();
    if (boxes.length !== 5) return null;
    return { width: video.videoWidth, height: video.videoHeight, boxes: boxes.map(box => ({
      x: box.x * video.videoWidth / width, y: box.y * video.videoHeight / height,
      width: box.width * video.videoWidth / width, height: box.height * video.videoHeight / height,
    })) };
  }

  function fingerprint(layout) {
    const ctx = signatureCanvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, 640, 40);
    layout.boxes.forEach((box, i) => {
      ctx.drawImage(video, box.x + box.width * 0.04, box.y + box.height * 0.12,
        box.width * 0.92, box.height * 0.76, i * 128, 0, 128, 40);
    });
    // One readback for all five crops. A short word changing must not disappear
    // into the average color of an otherwise unchanged button.
    const data = ctx.getImageData(0, 0, 640, 40).data;
    const pixels = new Uint8Array(128 * 40 * 5), ink = new Uint16Array(5);
    let valid = true;
    for (let tag = 0; tag < 5; tag++) {
      let background = 0;
      for (let y = 0; y < 40; y++) for (let x = 0; x < 128; x++) {
        const i = (y * 640 + tag * 128 + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const light = r * 0.299 + g * 0.587 + b * 0.114 > 175 ? 1 : 0;
        pixels[tag * 5120 + y * 128 + x] = light;
        ink[tag] += light;
        const dark = Math.max(r, g, b) < 110 && Math.min(r, g, b) > 15 && Math.max(r, g, b) - Math.min(r, g, b) < 28;
        const blue = r < 70 && g > 90 && b > 135 && b > g;
        background += dark || blue ? 1 : 0;
      }
      valid &&= background > 5120 * 0.5 && ink[tag] >= 8 && ink[tag] < 5120 * 0.4;
    }
    return { ...layout, pixels, ink, valid, observedAt: performance.now() };
  }

  function same(a, b) {
    if (!a?.valid || !b?.valid || a.width !== b.width || a.height !== b.height) return false;
    if (a.boxes.some((box, i) => ['x', 'y', 'width', 'height'].some(key => Math.abs(box[key] - b.boxes[i][key]) > 2))) return false;
    for (let tag = 0; tag < 5; tag++) {
      let changed = 0;
      for (let i = tag * 5120; i < (tag + 1) * 5120; i++) changed += a.pixels[i] !== b.pixels[i];
      // Relative to text ink, not the much larger button background.
      if (changed > Math.max(3, (a.ink[tag] + b.ink[tag]) * 0.025)) return false;
    }
    return true;
  }

  function markMissing(text) {
    if (pending) revision++;
    pending = accepted = undefined;
    missingSince ??= performance.now();
    if (!missingReported && performance.now() - missingSince >= 600) {
      missingReported = true;
      onMissing(text + ' Your previous screenshot is kept until different tags are confirmed.');
    }
  }

  function recognize(current, token) {
    const job = { revision, token, forceRecognition: manualRefresh };
    inFlight = job;
    // Freeze this candidate while sampling continues on the live video.
    const snapshot = document.createElement('canvas');
    snapshot.width = current.width; snapshot.height = current.height;
    snapshot.getContext('2d').drawImage(video, 0, 0);
    const isCurrent = () => {
      if (token !== session || state !== 'active' || job.revision !== revision ||
          stream.getVideoTracks()[0]?.muted || video.readyState < 2 ||
          video.videoWidth !== current.width || video.videoHeight !== current.height) return false;
      // Recheck actual pixels at commit time, even after background throttling.
      return same(current, fingerprint(current));
    };
    (async () => {
      try {
        const success = await onFrame(snapshot, { boxes: current.boxes, isCurrent, forceRecognition: job.forceRecognition });
        if (!isCurrent()) return;
        if (success) {
          if (job.forceRecognition) manualRefresh = false;
          accepted = current; failures = 0; retryAt = 0;
          verifyAt = performance.now() + (performance.now() < wakeUntil ? WAKE_VERIFY_INTERVAL : VERIFY_INTERVAL);
        }
        else {
          retryAt = performance.now() + Math.min(1600, 200 * 2 ** failures++);
          // A crop may have moved within a same-size capture. Reacquire geometry
          // before the first retry instead of waiting for the periodic scan.
          if (failures === 1) lastDetection = -Infinity;
        }
      } catch {
        if (token === session && job.revision === revision) {
          retryAt = performance.now() + Math.min(1600, 200 * 2 ** failures++);
          onStatus('Could not read all five tags yet. Your previous input is unchanged — I’ll try again shortly.');
        }
      } finally {
        snapshot.width = snapshot.height = 1;
        if (inFlight === job) inFlight = undefined;
        // No frame queue: immediately consider the latest stable input.
        if (token === session && state === 'active') sample(token);
      }
    })();
  }

  function sample(token, force = false) {
    if (token !== session || state !== 'active') return;
    cancelScheduled();
    lastCheck = performance.now();
    try {
      if (stream.getVideoTracks()[0]?.muted || video.readyState < 2 || !video.videoWidth) {
        markMissing('Waiting for the game window. Keep it open so its tags can be read.');
        return;
      }
      if (grid?.width !== video.videoWidth || grid?.height !== video.videoHeight) grid = undefined;
      let current = grid && fingerprint(grid);
      if (force || !current?.valid || lastCheck - lastDetection >= RESCAN_INTERVAL) {
        if (force || lastCheck - lastDetection >= FALLBACK_INTERVAL) {
          const located = locate();
          if (located) { grid = located; current = fingerprint(grid); }
          else current = null;
        }
      }
      if (!current?.valid) {
        markMissing('Open the recruitment screen in the shared game window. I’ll read the five tags automatically.');
        return;
      }
      missingSince = undefined; missingReported = false;
      if (!same(current, pending)) {
        revision++;
        pending = current;
        failures = 0; retryAt = 0;
        return;
      }
      // Pixel equality is only a fast path, never an indefinite veto on reading
      // tags. Recognition checks the current full-resolution crops and can reuse
      // exact cached tag images without rebuilding an unchanged result.
      if (lastCheck - pending.observedAt < SETTLE_INTERVAL ||
          (same(current, accepted) && lastCheck < verifyAt) || inFlight || lastCheck < retryAt) return;
      recognize(current, token);
    } catch {
      if (token === session) {
        stop();
        onStatus('The shared window could not be read. Turn Screen share on to try again.');
      }
    } finally {
      if (token === session && state === 'active') schedule(token);
    }
  }

  async function start() {
    if (!navigator.mediaDevices?.getDisplayMedia || !window.isSecureContext) {
      onStatus('Screen sharing is not available here. Try Chrome or Edge on localhost or HTTPS, or paste a screenshot.');
      return;
    }
    const token = ++session;
    state = 'starting';
    button.setAttribute('aria-pressed', 'true'); button.textContent = 'Cancel sharing';
    onStatus('Choose Window, then Arknights, and click Share. Your browser requires you to make this selection.');
    try {
      const selection = navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'window', frameRate: { ideal: 20, max: 20 } },
        audio: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude',
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
      grid = pending = accepted = undefined;
      lastCheck = lastDetection = -Infinity;
      retryAt = failures = 0; missingSince = undefined; missingReported = false;
      verifyAt = wakeUntil = 0;
      manualRefresh = false;
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
  return { stop, refresh, get active() { return state !== 'idle'; } };
};

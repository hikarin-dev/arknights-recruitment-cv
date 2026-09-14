const assert = require('node:assert/strict');

module.exports = async function checkScreenShareTiming(page) {
  // Real video/canvas/CV, with a controllable OCR boundary to exercise scheduling.
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    const original = await createImageBitmap(await (await fetch('/sampleimg/Arknights_B1lp26SeBZ.png')).blob());
    canvas.width = original.width; canvas.height = original.height;
    const ctx = canvas.getContext('2d');
    const originalDetect = RecruitVision.detectButtons;
    const originalRead = CanvasRenderingContext2D.prototype.getImageData;
    const originalPicker = navigator.mediaDevices.getDisplayMedia;
    const originalFrameCallback = HTMLVideoElement.prototype.requestVideoFrameCallback;
    window.timing = { detections: 0, probes: 0, missing: 0, frames: 0, frameCallbacks: 0, statuses: [], jobs: [], validResults: [], startedAt: [] };
    RecruitVision.detectButtons = (...args) => {
      timing.detections++;
      const boxes = originalDetect(...args);
      if (!boxes.length) timing.missing++;
      return boxes;
    };
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      if (this.canvas.width === 640 && this.canvas.height === 40) timing.probes++;
      return originalRead.apply(this, args);
    };
    HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
      return originalFrameCallback.call(this, (...args) => { timing.frameCallbacks++; callback(...args); });
    };
    const draw = changed => {
      ctx.drawImage(original, 0, 0);
      if (changed === true) {
        ctx.fillStyle = '#aaa';
        [[750, 720], [1084, 720], [1418, 720], [750, 864], [1084, 864]]
          .forEach(([x, y]) => ctx.fillRect(x, y, 290, 94));
      } else if (typeof changed === 'string') {
        ctx.fillStyle = '#333'; ctx.fillRect(750, 720, 290, 94);
        ctx.fillStyle = 'white'; ctx.font = '32px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(changed, 895, 767);
      }
      window.timingStream?.getVideoTracks()[0].requestFrame();
    };
    draw(false);
    navigator.mediaDevices.getDisplayMedia = async () => {
      window.timingStream = canvas.captureStream(20);
      draw(false);
      return timingStream;
    };
    const button = document.createElement('button');
    window.timingController = RecruitScreenShare({
      button, onRequest() {}, onStart() {}, onStop() {}, onMissing() {},
      onStatus(text) { timing.statuses.push(text); },
      async onFrame(snapshot, capture) {
        timing.frames++;
        timing.jobs.push(capture);
        timing.startedAt.push(performance.now());
        if (timing.hold) await new Promise(resolve => { timing.release = resolve; });
        timing.validResults.push(capture.isCurrent());
        if (timing.failNext) { timing.failNext--; return false; }
        return true;
      },
    });
    timing.draw = draw;
    timing.start = () => button.click();
    timing.restore = () => {
      timingController.stop();
      original.close();
      RecruitVision.detectButtons = originalDetect;
      CanvasRenderingContext2D.prototype.getImageData = originalRead;
      navigator.mediaDevices.getDisplayMedia = originalPicker;
      HTMLVideoElement.prototype.requestVideoFrameCallback = originalFrameCallback;
    };
    timing.start();
  });
  try {
    await page.waitForFunction(() => timing.frames === 1);
    await page.evaluate(() => { timing.probes = timing.detections = 0; });
    await page.waitForTimeout(1900);
    const idle = await page.evaluate(() => ({ ...timing }));
    assert.ok(idle.probes >= 10, 'text tracking continues on a still frame');
    assert.ok(idle.detections >= 2 && idle.detections <= 4, 'geometry is reacquired regularly without full CV on every check');
    assert.ok(idle.frames >= 2 && idle.frames <= 4, `unchanged fingerprints are periodically verified: ${idle.frames} reads, ${idle.detections} detections, ${idle.probes} probes`);

    await page.evaluate(() => {
      timing.frames = 1;
      timing.jobs = timing.jobs.slice(-1);
      timing.validResults = [true];
      timing.startedAt = timing.startedAt.slice(-1);
      timing.hold = true;
      timing.draw(true);
    });
    await page.waitForFunction(() => timing.missing > 0);
    await page.evaluate(() => timing.draw(false));
    await page.waitForFunction(() => timing.frames === 2);

    const wakes = await page.evaluate(() => {
      const before = timing.probes;
      const detections = timing.detections;
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('blur'));
      document.dispatchEvent(new Event('visibilitychange'));
      timingStream.getVideoTracks()[0].dispatchEvent(new Event('unmute'));
      return { probes: timing.probes - before, detections: timing.detections - detections };
    });
    assert.ok(wakes.probes >= 4, 'focus, blur, visibility and capture resume each check immediately');
    assert.equal(wakes.detections, 4, 'wake events always reacquire geometry even when cached pixels look valid');

    assert.ok(await page.evaluate(() => timing.frameCallbacks > 0), 'fresh video callbacks are used');
    const duringOCR = await page.evaluate(() => {
      const before = timing.probes;
      for (let i = 0; i < 20; i++) {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      }
      return { before, after: timing.probes };
    });
    assert.ok(duringOCR.after > duringOCR.before, 'event bursts keep tracking during OCR');
    await page.evaluate(() => timing.draw('Defender'));
    await page.waitForFunction(() => !timing.jobs[1].isCurrent());
    await page.evaluate(() => timing.draw('Caster'));
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => timing.frames), 2, 'new inputs cannot overlap a pending OCR job');
    assert.ok(await page.evaluate(() => timing.probes) > duringOCR.after, 'scheduled tracking continues while OCR is blocked');
    await page.evaluate(() => { timing.hold = false; timing.release(); });
    await page.waitForFunction(() => timing.frames === 3 && timing.validResults.length === 3);
    assert.deepEqual(await page.evaluate(() => timing.validResults), [true, false, true], 'superseded OCR is rejected; only the newest candidate is valid');
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => timing.frames), 3, 'intermediate frames do not build a queue');
    await page.evaluate(() => { timing.failNext = 1; timing.draw('Guard'); });
    await page.waitForFunction(() => timing.frames === 5 && timing.validResults.length === 5);
    const retryDelay = await page.evaluate(() => timing.startedAt[4] - timing.startedAt[3]);
    assert.ok(retryDelay >= 190 && retryDelay < 1500, `failed recognition should retry promptly with backoff, took ${retryDelay} ms`);
    console.log('PASS: continuous text tracking, transition revalidation, latest-frame scheduling, stale-result rejection, fast failure retry');

    await page.evaluate(() => timingController.stop());
    const stopped = await page.evaluate(() => timing.detections);
    await page.waitForTimeout(400);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await page.evaluate(() => timing.detections), stopped, 'stop cancels both timer and frame callbacks');

    await page.evaluate(() => {
      HTMLVideoElement.prototype.requestVideoFrameCallback = undefined;
      timing.start();
    });
    await page.waitForFunction(() => timing.frames === 6);
    assert.equal(await page.evaluate(() => timingController.active), true);
    console.log('PASS: timer fallback without video-frame callbacks and complete scheduler cleanup');

    await page.evaluate(() => { timing.hold = true; timingController.refresh(); });
    await page.waitForFunction(() => timing.frames === 7);
    assert.equal(await page.evaluate(() => timing.jobs[6].forceRecognition), true, 'manual refresh bypasses cached recognition');
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) timingController.refresh();
    });
    assert.equal(await page.evaluate(() => timing.jobs[6].isCurrent()), false, 'manual refresh invalidates the older read even with identical pixels');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => timing.frames), 7, 'repeated refresh requests cannot overlap an active read');
    await page.evaluate(() => { timing.hold = false; timing.release(); });
    await page.waitForFunction(() => timing.frames === 8 && timing.validResults.length === 8);
    assert.equal(await page.evaluate(() => timing.jobs[7].forceRecognition), true, 'the queued refresh retains its cache bypass');
    assert.deepEqual(await page.evaluate(() => timing.validResults.slice(-2)), [false, true]);
    await page.evaluate(() => timingController.stop());
    await page.evaluate(() => timingController.refresh());
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => timing.frames), 8, 'refresh after stop cannot restart capture');
    console.log('PASS: manual refresh bypass, stale-job rejection, coalescing, and stopped-session guard');
  } finally {
    await page.evaluate(() => timing.restore());
  }
};

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
    window.timing = { detections: 0, probes: 0, missing: 0, frames: 0, frameCallbacks: 0, statuses: [] };
    RecruitVision.detectButtons = (...args) => {
      timing.detections++;
      const boxes = originalDetect(...args);
      if (!boxes.length) timing.missing++;
      return boxes;
    };
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      if (this.canvas.width === 80 && this.canvas.height === 8) timing.probes++;
      return originalRead.apply(this, args);
    };
    HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
      return originalFrameCallback.call(this, (...args) => { timing.frameCallbacks++; callback(...args); });
    };
    const draw = changed => {
      ctx.drawImage(original, 0, 0);
      if (changed) {
        ctx.fillStyle = '#aaa';
        [[750, 720], [1084, 720], [1418, 720], [750, 864], [1084, 864]]
          .forEach(([x, y]) => ctx.fillRect(x, y, 290, 94));
      }
      window.timingStream?.getVideoTracks()[0].requestFrame();
    };
    draw(false);
    navigator.mediaDevices.getDisplayMedia = async () => {
      window.timingStream = canvas.captureStream(10);
      draw(false);
      return timingStream;
    };
    const button = document.createElement('button');
    window.timingController = RecruitScreenShare({
      button, onRequest() {}, onStart() {}, onStop() {}, onMissing() {},
      onStatus(text) { timing.statuses.push(text); },
      async onFrame() {
        timing.frames++;
        if (timing.hold) await new Promise(resolve => { timing.release = resolve; });
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
    assert.ok(idle.probes >= 6, 'cheap color checks continue on a still frame');
    assert.ok(idle.detections <= 3, 'unchanged buttons avoid full CV on every check');
    assert.equal(idle.frames, 1, 'unchanged buttons never start another OCR job');

    const wakes = await page.evaluate(() => {
      const before = timing.detections;
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('blur'));
      document.dispatchEvent(new Event('visibilitychange'));
      timingStream.getVideoTracks()[0].dispatchEvent(new Event('unmute'));
      return timing.detections - before;
    });
    assert.equal(wakes, 4, 'focus, blur, visibility and capture resume each check immediately');

    await page.evaluate(() => { timing.hold = true; timing.draw(true); });
    await page.waitForFunction(() => timing.missing > 0);
    await page.evaluate(() => timing.draw(false));
    await page.waitForFunction(() => timing.frames === 2);
    assert.ok(await page.evaluate(() => timing.frameCallbacks > 0), 'fresh video callbacks are used');
    const duringOCR = await page.evaluate(() => {
      const before = timing.detections;
      for (let i = 0; i < 20; i++) {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      }
      return { before, after: timing.detections };
    });
    assert.equal(duringOCR.after, duringOCR.before, 'event bursts cannot overlap a pending OCR job');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => timing.frames), 2);
    await page.evaluate(() => { timing.hold = false; timing.release(); });
    await page.waitForFunction(before => timing.detections > before, duringOCR.before);
    assert.equal(await page.evaluate(() => timing.detections), duringOCR.before + 1, 'one coalesced check follows OCR');
    assert.equal(await page.evaluate(() => timing.frames), 2, 'the follow-up does not repeat successful OCR');
    console.log('PASS: cheap idle color checks, all-five color transition revalidation, immediate focus checks, coalesced OCR wake-ups');

    await page.evaluate(() => timingController.stop());
    const stopped = await page.evaluate(() => timing.detections);
    await page.waitForTimeout(400);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await page.evaluate(() => timing.detections), stopped, 'stop cancels both timer and frame callbacks');

    await page.evaluate(() => {
      HTMLVideoElement.prototype.requestVideoFrameCallback = undefined;
      timing.start();
    });
    await page.waitForFunction(() => timing.frames === 3);
    assert.equal(await page.evaluate(() => timingController.active), true);
    console.log('PASS: timer fallback without video-frame callbacks and complete scheduler cleanup');
  } finally {
    await page.evaluate(() => timing.restore());
  }
};

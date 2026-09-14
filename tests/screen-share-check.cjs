const assert = require('node:assert/strict');

module.exports = async function checkScreenShare(page) {
  if (process.env.DEBUG_SCREEN_SHARE) await page.exposeFunction('reportShareStatus', text => console.log('SHARE:', text));
  await page.evaluate(async () => {
    const capture = document.createElement('canvas');
    capture.width = 2560; capture.height = 1440;
    window.drawSharedSample = async file => {
      const bitmap = await createImageBitmap(await (await fetch('/sampleimg/' + file)).blob());
      capture.getContext('2d').drawImage(bitmap, 0, 0, capture.width, capture.height);
      bitmap.close();
    };
    window.blankSharedSample = () => capture.getContext('2d').clearRect(0, 0, capture.width, capture.height);
    window.restyleSharedTags = () => {
      // Same words in a different font: pixels change enough to trigger OCR.
      const ctx = capture.getContext('2d');
      const positions = [[750, 720], [1084, 720], [1418, 720], [750, 864], [1084, 864]];
      ['Guard', 'Medic', 'Starter', 'Survival', 'AoE'].forEach((text, i) => {
        const [x, y] = positions[i];
        ctx.fillStyle = '#333'; ctx.fillRect(x, y, 290, 94);
        ctx.fillStyle = 'white'; ctx.font = '32px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 145, y + 47);
      });
    };
    window.replaceFirstSharedTag = text => {
      const ctx = capture.getContext('2d');
      ctx.fillStyle = '#333'; ctx.fillRect(750, 720, 290, 94);
      ctx.fillStyle = 'white'; ctx.font = '32px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, 895, 767);
      window.sharedStream.getVideoTracks()[0].requestFrame();
    };
    window.newSharedStream = () => {
      window.sharedStream = capture.captureStream(5);
      capture.getContext('2d').drawImage(capture, 0, 0);
      window.sharedStream.getVideoTracks()[0].requestFrame();
      return window.sharedStream;
    };
    navigator.mediaDevices.getDisplayMedia = async options => {
      window.shareOptions = options;
      return window.newSharedStream();
    };
    await window.drawSharedSample('Arknights_B1lp26SeBZ.png');
    window.shareScans = 0;
    new MutationObserver(() => {
      if (window.reportShareStatus) window.reportShareStatus(document.getElementById('screenshotStatus').textContent);
      if (document.getElementById('screenshotStatus').textContent === 'Opening screenshot…') window.shareScans++;
    }).observe(document.getElementById('screenshotStatus'), { childList: true });
    window.sharedClipboardReads = 0;
    navigator.clipboard.read = async () => { window.sharedClipboardReads++; return []; };
  });
  const toggle = page.locator('#screenShareToggle');
  async function waitForTags(names) {
    await page.waitForFunction(expected => {
      const status = document.getElementById('screenshotStatus').textContent;
      const selected = [...document.querySelectorAll('#tagList .checked')].map(el => el.textContent).sort();
      return status.includes('Read 5/5') && status.includes('automatically') && JSON.stringify(selected) === JSON.stringify(expected.sort());
    }, names, { timeout: 45000 });
  }
  await toggle.click();
  await waitForTags(['Guard', 'Medic', 'Starter', 'Survival', 'AoE']);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => shareOptions.audio), false);
  assert.equal(await page.locator('#tagList').isVisible(), false);
  const scans = await page.evaluate(() => shareScans);
  // Let multiple sampling cycles pass to verify unchanged tags do not re-run OCR.
  await page.waitForTimeout(1900);
  assert.equal(await page.evaluate(() => shareScans), scans);
  assert.equal(await page.evaluate(() => sharedClipboardReads), 0);
  await page.evaluate(() => {
    window.savedShareImage = document.querySelector('#screenshotBackground img').src;
    window.savedShareRow = document.querySelector('#recruitResults tr');
    window.savedShareHighlight = document.querySelector('.recognized-tag');
    window.shareRecognitionCalls = 0;
    window.snapshotsDuringOCR = [];
    const matchTag = RecruitVision.matchTag;
    RecruitVision.matchTag = (...args) => {
      window.shareRecognitionCalls++;
      window.snapshotsDuringOCR.push(document.querySelector('#screenshotBackground img').src === savedShareImage && document.querySelector('#recruitResults tr') === savedShareRow);
      return matchTag(...args);
    };
    restyleSharedTags();
  });
  await page.waitForFunction(() => shareRecognitionCalls >= 5, null, { timeout: 45000 });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.querySelector('#screenshotBackground img').src === savedShareImage && document.querySelector('#recruitResults tr') === savedShareRow && document.querySelector('.recognized-tag') === savedShareHighlight), true, 'changed pixels but same recognized tags must not refresh the UI');
  console.log('PASS: identical recognized tags preserve the previous screenshot and DOM despite changed pixels');
  await page.evaluate(() => drawSharedSample('Arknights_LYbMFH4VHl.png'));
  await waitForTags(['Medic', 'Supporter', 'Caster', 'Melee', 'AoE']);
  assert.equal(await page.evaluate(() => snapshotsDuringOCR.length > 5 && snapshotsDuringOCR.every(Boolean)), true, 'old image and results stay intact throughout recognition, including a genuinely new tag set');
  assert.notEqual(await page.evaluate(() => document.querySelector('#screenshotBackground img').src), await page.evaluate(() => savedShareImage));
  const selectedBeforeMissing = await page.locator('#tagList .checked').allTextContents();
  await page.evaluate(() => blankSharedSample());
  await page.waitForFunction(() => document.getElementById('screenshotStatus').textContent.includes('Open the recruitment screen'));
  assert.deepEqual(await page.locator('#tagList .checked').allTextContents(), selectedBeforeMissing);
  assert.equal(await page.locator('.recognized-tag').count(), 5);
  await page.evaluate(() => drawSharedSample('Arknights_B1lp26SeBZ.png'));
  await waitForTags(['Guard', 'Medic', 'Starter', 'Survival', 'AoE']);
  const callsAfterReturn = await page.evaluate(() => shareRecognitionCalls);
  await page.evaluate(() => replaceFirstSharedTag('Defender'));
  await waitForTags(['Defender', 'Medic', 'Starter', 'Survival', 'AoE']);
  const callsAfterOneChange = await page.evaluate(() => shareRecognitionCalls);
  assert.equal(callsAfterOneChange - callsAfterReturn, 1, 'changing one tag reuses the other four recognized images');
  await page.evaluate(() => drawSharedSample('Arknights_B1lp26SeBZ.png'));
  await waitForTags(['Guard', 'Medic', 'Starter', 'Survival', 'AoE']);
  assert.equal(await page.evaluate(() => shareRecognitionCalls), callsAfterOneChange, 'returning to identical cached tag images needs no OCR');
  console.log('PASS: returning tags need no OCR; a single changed tag needs just one OCR call');

  // Simulate a false "unchanged" result in the low-resolution transition probe.
  // Actual capture frames, full-resolution crops and OCR remain real.
  await page.evaluate(() => {
    window.originalShareRead = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      const pixels = originalShareRead.apply(this, args);
      if (this.canvas.width === 640 && this.canvas.height === 40) {
        window.frozenShareProbe ??= pixels;
        return frozenShareProbe;
      }
      return pixels;
    };
  });
  try {
    await page.waitForFunction(() => !!window.frozenShareProbe);
    await page.evaluate(() => replaceFirstSharedTag('Caster'));
    await waitForTags(['Caster', 'Medic', 'Starter', 'Survival', 'AoE']);
    // Focus arrives before the browser delivers the new game frame. Its immediate
    // check sees old tags; the follow-up must still find the delayed update.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(150);
    await page.evaluate(() => replaceFirstSharedTag('Defender'));
    await waitForTags(['Defender', 'Medic', 'Starter', 'Survival', 'AoE']);
    console.log('PASS: real tag updates despite frozen transition probes and delayed frames after focus');
  } finally {
    await page.evaluate(() => {
      CanvasRenderingContext2D.prototype.getImageData = originalShareRead;
      delete window.originalShareRead;
      delete window.frozenShareProbe;
    });
  }

  const callsBeforeRefresh = await page.evaluate(() => {
    window.beforeManualImage = document.querySelector('#screenshotBackground img').src;
    window.beforeManualRow = document.querySelector('#recruitResults tr');
    return shareRecognitionCalls;
  });
  await page.locator('#screenshotStatus').click();
  await page.waitForFunction(before => shareRecognitionCalls >= before + 5, callsBeforeRefresh, { timeout: 45000 });
  await waitForTags(['Defender', 'Medic', 'Starter', 'Survival', 'AoE']);
  assert.equal(await page.evaluate(() => sharedClipboardReads), 0, 'manual shared capture never reads the clipboard');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true', 'manual refresh keeps the existing stream');
  assert.equal(await page.evaluate(() => document.querySelector('#screenshotBackground img').src === beforeManualImage && document.querySelector('#recruitResults tr') === beforeManualRow), true, 'manual recognition of the same tags preserves the screenshot and results');
  console.log('PASS: background click forces OCR of all five cached tags without clipboard access or UI replacement');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => sharedStream.getTracks().every(track => track.readyState === 'ended')), true);
  assert.equal(await page.locator('#tagList .checked').count(), 5, 'stopping keeps the last recognized screenshot');
  console.log('PASS: automatic OCR updates, unchanged-tag skipping, no clipboard reads, preservation during missing grids, stream cleanup');

  await toggle.click();
  await page.waitForFunction(() => document.getElementById('screenShareToggle').textContent === 'Stop sharing');
  await page.evaluate(() => sharedStream.getVideoTracks()[0].dispatchEvent(new Event('ended')));
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => sharedStream.getTracks().every(track => track.readyState === 'ended')), true);

  await page.evaluate(() => { navigator.mediaDevices.getDisplayMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await toggle.click();
  await page.waitForFunction(() => document.getElementById('screenshotStatus').textContent.includes('wasn’t started'));
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');

  await page.evaluate(() => { navigator.mediaDevices.getDisplayMedia = () => new Promise(resolve => { window.resolveShare = resolve; }); });
  await toggle.click();
  assert.equal(await toggle.innerText(), 'Cancel sharing');
  await toggle.click();
  await page.evaluate(() => resolveShare(newSharedStream()));
  await page.waitForFunction(() => sharedStream.getTracks().every(track => track.readyState === 'ended'));
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');

  await page.evaluate(() => { navigator.mediaDevices.getDisplayMedia = async () => newSharedStream(); });
  await toggle.click();
  await page.waitForFunction(() => document.getElementById('screenShareToggle').textContent === 'Stop sharing');
  await page.locator('#screenshotToggle').click();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => sharedStream.getTracks().every(track => track.readyState === 'ended')), true);
  assert.equal(await page.locator('#tagList').isVisible(), true);
  console.log('PASS: browser Stop sharing, canceled picker, denied permission, late-stream cleanup, manual-mode capture shutdown');
};

/* Clipboard -> Canvas CV -> local Tesseract worker -> calculator. */
(() => {
  const status = document.getElementById('screenshotStatus');
  const toggle = document.getElementById('screenshotToggle');
  const background = document.querySelector('#screenshotBackground img');
  const highlights = document.getElementById('screenshotHighlights');
  const shade = document.getElementById('screenshotShade');
  const clearButton = document.getElementById('clearScreenshot');
  const fullscreenHint = document.getElementById('fullscreenHint');
  const fullscreenToggle = document.getElementById('fullscreenToggle');
  const language = { en_US: 'eng', ja_JP: 'jpn', ko_KR: 'kor', zh_CN: 'chi_sim' }[serverString] || 'eng';
  let enabled = localStorage.getItem('screenshotInputEnabled') === 'true', generation = 0, objectURL, workerPromise, libraryPromise;
  let lastTagKey = '';
  let recognized = [], bestGroups = [], queue = Promise.resolve();
  let tagBoxes = [];
  let fullscreenPending = false;
  const tagCache = RecruitVision.createTagCache();
  const controls = 'button, a, input, textarea, select, label, summary, [role="button"], [contenteditable], .button, .operatorCheckbox, .nav-dropdown, .hotkeys-icon, #reset';
  const pasteInstructions = 'Copy a recruitment screenshot, then click anywhere on the background to paste it. You can also press Ctrl+V.';

  function message(text) { if (status.textContent !== text) status.textContent = text; }

  function setInputMode(active) {
    enabled = active;
    localStorage.setItem('screenshotInputEnabled', String(active));
    screenshotInputActive = active;
    toggle.setAttribute('aria-pressed', String(active));
    document.body.classList.toggle('screenshot-input-enabled', active);
    document.getElementById('tagList').inert = active;
    tagInput.disabled = active;
    if (active) tagInput.blur();
  }

  async function toggleFullscreen() {
    if (fullscreenPending) return;
    fullscreenPending = true;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      fullscreenHint.hidden = true;
    } catch {
      fullscreenHint.hidden = false;
    } finally { fullscreenPending = false; }
  }

  setInputMode(enabled);
  message(enabled ? pasteInstructions : 'Click the tags below to choose them yourself, or turn Screenshot input on to paste a screenshot.');
  fullscreenToggle.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    const active = !!document.fullscreenElement;
    fullscreenToggle.setAttribute('aria-pressed', String(active));
    fullscreenToggle.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    fullscreenToggle.title = active ? 'Exit fullscreen' : 'Enter fullscreen';
    fullscreenToggle.firstElementChild.className = active ? 'fas fa-compress' : 'fas fa-expand';
    drawHighlights();
  });

  function loadLibrary() {
    if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
      script.onload = resolve;
      script.onerror = () => { script.remove(); libraryPromise = null; reject(new Error('Could not load OCR. Check your connection and paste again.')); };
      document.head.appendChild(script);
    });
    return libraryPromise;
  }

  async function getWorker() {
    if (!workerPromise) workerPromise = (async () => {
      await loadLibrary();
      const worker = await Tesseract.createWorker(language, 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
      });
      await worker.setParameters({ tessedit_pageseg_mode: '7', user_defined_dpi: '150' });
      return worker;
    })().catch(error => { workerPromise = null; throw error; });
    return workerPromise;
  }

  function canvas(width, height) {
    const el = document.createElement('canvas');
    el.width = Math.round(width); el.height = Math.round(height);
    return el;
  }

  function cropTag(source, box, binary) {
    const insetX = box.width * 0.035, insetY = box.height * 0.12;
    const height = box.height - insetY * 2, scale = 70 / height;
    const output = canvas((box.width - insetX * 2) * scale + 24, 94);
    const ctx = output.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, output.width, output.height);
    ctx.drawImage(source, box.x + insetX, box.y + insetY, box.width - insetX * 2, height, 12, 12, output.width - 24, 70);
    const pixels = ctx.getImageData(12, 12, output.width - 24, 70);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const luminance = pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114;
      // Both unselected dark buttons and selected blue buttons have white text.
      const value = binary ? (luminance > 175 ? 0 : 255) : 255 - luminance;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
    }
    ctx.putImageData(pixels, 12, 12);
    return output;
  }

  function drawHighlights() {
    highlights.replaceChildren();
    const bounds = background.getBoundingClientRect();
    const width = bounds.width || window.innerWidth, height = bounds.height || window.innerHeight;
    shade.setAttribute('viewBox', `0 0 ${width} ${height}`);
    let shadePath = `M0 0H${width}V${height}H0Z`;
    shade.firstElementChild.setAttribute('d', shadePath);
    if (!background.naturalWidth || !bounds.width) return;
    const scale = Math.min(bounds.width / background.naturalWidth, bounds.height / background.naturalHeight);
    const offsetX = (bounds.width - background.naturalWidth * scale) / 2;
    const offsetY = (bounds.height - background.naturalHeight * scale) / 2;
    // Cut undimmed windows around all five buttons, independent of the best combo.
    for (const box of tagBoxes) {
      const x = offsetX + box.x * scale, y = offsetY + box.y * scale;
      shadePath += `M${x} ${y}h${box.width * scale}v${box.height * scale}h${-box.width * scale}Z`;
    }
    shade.firstElementChild.setAttribute('d', shadePath);
    for (const item of recognized) {
      const el = document.createElement('div');
      const memberships = bestGroups.map((group, i) => group.tags.some(tag => String(tag.tagId) === String(item.tagId)) ? i + 1 : null).filter(Boolean);
      el.className = 'recognized-tag' + (memberships.length ? ' best-tag' : '');
      el.style.left = `${offsetX + item.box.x * scale}px`;
      el.style.top = `${offsetY + item.box.y * scale}px`;
      el.style.width = `${item.box.width * scale}px`;
      el.style.height = `${item.box.height * scale}px`;
      const label = document.createElement('span');
      label.textContent = item.tagName + (memberships.length ? ` · ${bestGroups.length > 1 ? 'combos ' + memberships.join(', ') : 'best'}` : '');
      el.appendChild(label);
      highlights.appendChild(el);
    }
  }

  function leaveAllCombos() {
    if (showCombos) document.getElementById('allCombosBtn').click();
  }

  function clearImage() {
    generation++;
    recognized = []; bestGroups = [];
    tagBoxes = [];
    lastTagKey = '';
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = undefined;
    background.removeAttribute('src');
    highlights.replaceChildren();
    document.body.classList.remove('screenshot-overlay');
    clearButton.hidden = true;
    calculateResults();
    message(enabled ? pasteInstructions : 'Screenshot input is off. Click the tags below to choose them yourself.');
  }

  async function processImage(input, live = false, capture) {
    const token = ++generation;
    const isCurrent = () => token === generation && (!capture || capture.isCurrent());
    if (!enabled) setInputMode(true);
    const progress = text => { if (!live || !objectURL) message(text); };
    progress('Opening screenshot…');
    let bitmap;
    try {
      bitmap = capture ? input : await createImageBitmap(input);
      if (!isCurrent()) return;
      // Stage the candidate locally. Keep the displayed screenshot and results intact.
      progress('Finding the five tag buttons…');
      let boxes = capture?.boxes;
      if (!boxes) {
        const scale = Math.min(1, 1280 / bitmap.width);
        const small = canvas(bitmap.width * scale, bitmap.height * scale);
        const ctx = small.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0, small.width, small.height);
        const detected = RecruitVision.detectButtons(ctx.getImageData(0, 0, small.width, small.height));
        if (detected.length !== 5) throw new Error('Could not find all five tag buttons. Your previous input is unchanged. Try a screenshot showing the whole recruitment screen, or turn Screenshot input off to choose the tags yourself.');
        boxes = detected.map(box => ({ x: box.x * bitmap.width / small.width, y: box.y * bitmap.height / small.height, width: box.width * bitmap.width / small.width, height: box.height * bitmap.height / small.height }));
      }
      progress('Getting ready to read your screenshot… This may take a moment the first time.');
      // A single worker processes images sequentially; superseded jobs cannot apply tags.
      const run = async () => {
        if (!isCurrent()) return;
        const worker = await getWorker();
        await recruitmentReady;
        if (!isCurrent()) return;
        const tags = Object.values(TAG_MAP).filter(tag => tag.tagCat !== undefined);
        if (!tags.length) throw new Error('Recruitment data is unavailable. Reload and try again.');
        const results = [], newEntries = [];
        for (let i = 0; i < boxes.length; i++) {
          if (!isCurrent()) return;
          progress(`Reading tag ${i + 1} of 5…`);
          const binaryCrop = cropTag(bitmap, boxes[i], true);
          const signature = live && tagCache.signature(binaryCrop.getContext('2d').getImageData(0, 0, binaryCrop.width, binaryCrop.height));
          let match = !capture?.forceRecognition && signature && tagCache.get(signature);
          if (match) {
            results.push({ tagId: String(match.tagId), tagName: match.tagName, box: boxes[i] });
            continue;
          }
          for (const binary of [true, false]) {
            const { data } = await worker.recognize(binary ? binaryCrop : cropTag(bitmap, boxes[i], false));
            if (!isCurrent()) return;
            match = RecruitVision.matchTag(data.text, tags);
            if (match && data.confidence >= (match.exact ? 35 : 65)) {
              if (signature && binary && match.exact && data.confidence >= 65) newEntries.push({ signature, match });
              break;
            }
            match = null;
          }
          if (match) results.push({ tagId: String(match.tagId), tagName: match.tagName, box: boxes[i] });
        }
        if (!isCurrent()) return;
        if (results.length !== 5 || new Set(results.map(r => r.tagId)).size !== 5) {
          throw new Error(`Could only read ${new Set(results.map(r => r.tagId)).size} of the five tags. Your previous input is unchanged. Try a clearer screenshot, or turn Screenshot input off to choose the tags yourself.`);
        }
        for (const entry of newEntries) tagCache.set(entry.signature, entry.match);
        const key = results.map(result => result.tagId).sort().join(',');
        const completedMessage = `Read 5/5 tags: ${(key === lastTagKey ? recognized : results).map(r => r.tagName).join(', ')}. ${live ? 'Screen share is on — new tags will be read automatically.' : 'To try another screenshot, copy it and click anywhere on the background.'}`;
        if (key === lastTagKey) {
          message(completedMessage);
          return true;
        }
        // Commit only a complete, different tag set; same tags never rebuild the UI.
        // Encode a full screenshot only for a confirmed, different tag set.
        const blob = capture ? await new Promise(resolve => bitmap.toBlob(resolve, 'image/png')) : input;
        if (!isCurrent()) return;
        if (!blob) throw new Error('Could not save the screenshot. Please try again.');
        const nextURL = URL.createObjectURL(blob);
        if (objectURL) URL.revokeObjectURL(objectURL);
        objectURL = nextURL;
        background.src = objectURL;
        lastTagKey = key;
        tagBoxes = boxes;
        document.body.classList.add('screenshot-overlay');
        clearButton.hidden = false;
        recognized = results;
        selectedTags = new Set(results.map(r => r.tagId));
        TAG_STACK = [...selectedTags];
        tagInput.value = '';
        possibleTagMatches = []; highlightedTagIndex = null;
        document.querySelectorAll('#tagList .button').forEach(el => {
          el.classList.remove('highlight', 'highlight_low');
          el.classList.toggle('checked', selectedTags.has(el.dataset.tagId));
        });
        tagTable.dataset.tooMany = 'false';
        leaveAllCombos();
        calculateResults();
        drawHighlights();
        message(completedMessage);
        return true;
      };
      queue = queue.catch(() => {}).then(run);
      return await queue;
    } catch (error) {
      if (isCurrent()) message(live
        ? 'Could not read all five tags yet. Your previous input is unchanged — I’ll try again shortly.'
        : error.message || 'Could not read screenshot. Try Ctrl+V or turn Screenshot input off to select tags manually.');
      return false;
    } finally { if (!capture) bitmap?.close(); }
  }

  async function readClipboard() {
    if (!window.isSecureContext || !navigator.clipboard?.read) {
      message("Your browser can't paste with a click here. Press Ctrl+V to paste your screenshot instead.");
      return;
    }
    const request = ++generation;
    try {
      const items = await navigator.clipboard.read();
      if (request !== generation || !enabled) return;
      for (const item of items) {
        const type = item.types.find(type => type.startsWith('image/'));
        if (type) {
          const blob = await item.getType(type);
          if (request === generation && enabled) return processImage(blob);
          return;
        }
      }
      message('No image found. Copy a recruitment screenshot first, then click anywhere on the background.');
    } catch {
      if (request === generation) message('Your browser blocked pasting. Press Ctrl+V instead, or allow clipboard access when your browser asks.');
    }
  }

  const screenShare = RecruitScreenShare({
    button: document.getElementById('screenShareToggle'),
    onRequest: () => { generation++; getWorker().catch(() => {}); },
    onStart: () => { setInputMode(true); },
    onFrame: (snapshot, capture) => processImage(snapshot, true, capture),
    onMissing: message,
    onStop: () => { generation++; message('Screen share stopped. ' + (enabled ? pasteInstructions : 'Choose tags below, or turn Screenshot input on to paste a screenshot.')); },
    onStatus: message,
  });

  document.addEventListener('click', event => {
    if (enabled && !event.target.closest(controls) && !window.getSelection()?.toString()) {
      if (screenShare.active) screenShare.refresh();
      else readClipboard();
    }
  });
  document.addEventListener('paste', event => {
    const item = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'));
    if (item) { event.preventDefault(); screenShare.stop(); processImage(item.getAsFile()); }
  });
  toggle.addEventListener('click', () => {
    screenShare.stop();
    setInputMode(!enabled);
    if (!enabled) clearImage();
    else {
      calculateResults();
      message(pasteInstructions);
    }
  });
  clearButton.addEventListener('click', () => { screenShare.stop(); clearImage(); });
  document.querySelector('#tagList').addEventListener('click', () => { if (screenshotInputActive) generation++; });
  tagInput.addEventListener('input', () => { if (screenshotInputActive) generation++; });
  tagInput.addEventListener('keydown', event => {
    if (screenshotInputActive && ['Enter', 'Backspace', 'Escape'].includes(event.key)) generation++;
  });
  document.getElementById('reset').addEventListener('click', () => { if (screenshotInputActive) generation++; });
  document.addEventListener('recruitment:ranked', event => { bestGroups = event.detail.best.slice(0, 1); drawHighlights(); });
  document.addEventListener('recruitment:highlight', event => { bestGroups = [event.detail]; drawHighlights(); });
  window.addEventListener('resize', drawHighlights);
  background.addEventListener('load', drawHighlights);
  // Prevent an unhandled rejection while still letting image input report data errors.
  recruitmentReady.catch(() => message('Could not load recruitment data. Check your connection and reload.'));
})();

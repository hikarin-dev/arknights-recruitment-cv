/* Scale-independent recruitment button detection; no fixed screenshot coordinates. */
(function (root) {
  function detectButtons(image) {
    const { width, height, data } = image;
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const dark = Math.max(r, g, b) < 105 && Math.min(r, g, b) > 20 && Math.max(r, g, b) - Math.min(r, g, b) < 22;
      const blue = r < 65 && g > 95 && b > 140 && b > g;
      mask[i] = dark || blue ? 1 : 0;
    }
    const queue = new Int32Array(mask.length);
    const rectangles = [];
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start]) continue;
      let head = 0, tail = 1, count = 0;
      queue[0] = start;
      mask[start] = 0;
      let x0 = width, y0 = height, x1 = 0, y1 = 0;
      while (head < tail) {
        const i = queue[head++], x = i % width, y = Math.floor(i / width);
        count++;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        for (const next of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
          if (next >= 0 && next < mask.length && mask[next]) {
            mask[next] = 0;
            queue[tail++] = next;
          }
        }
      }
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      if (w / h > 2.3 && w / h < 4.5 && w > width * 0.035 && w < width * 0.3 && h >= 10 && count / (w * h) > 0.68) {
        rectangles.push({ x: x0, y: y0, width: w, height: h });
      }
    }
    // Find a 3 + 2 grid with consistent size, spacing, and row alignment.
    const grids = [];
    for (const a of rectangles) {
      const similar = rectangles.filter(b => Math.abs(b.width / a.width - 1) < 0.18 && Math.abs(b.height / a.height - 1) < 0.2);
      for (const b of similar) {
        const dx = b.x - a.x;
        if (dx < a.width * 1.03 || dx > a.width * 1.65 || Math.abs(b.y - a.y) > a.height * 0.2) continue;
        const c = similar.find(r => Math.abs(r.x - a.x - 2 * dx) < a.width * 0.15 && Math.abs(r.y - a.y) < a.height * 0.2);
        if (!c) continue;
        for (const d of similar) {
          const dy = d.y - a.y;
          if (Math.abs(d.x - a.x) > a.width * 0.15 || dy < a.height * 1.15 || dy > a.height * 2.4) continue;
          const e = similar.find(r => Math.abs(r.x - b.x) < a.width * 0.15 && Math.abs(r.y - d.y) < a.height * 0.2);
          if (e) grids.push([a, b, c, d, e]);
        }
      }
    }
    // Reject ambiguous layouts instead of silently reading the wrong panel.
    return grids.length === 1 ? grids[0] : [];
  }

  function normalize(text) {
    return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  }

  function distance(a, b) {
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 0; i < a.length; i++) {
      const next = [i + 1];
      for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] !== b[j])));
      row = next;
    }
    return row[b.length];
  }

  function matchTag(text, tags) {
    const normalized = normalize(text);
    if (!normalized) return null;
    const ranked = tags.map(tag => ({ tag, error: distance(normalized, normalize(tag.tagName)) })).sort((a, b) => a.error - b.error);
    const best = ranked[0];
    if (!best || (ranked[1] && ranked[1].error === best.error)) return null;
    // Short names require an exact match; long names allow one or two OCR errors.
    const limit = normalized.length < 5 ? 0 : normalized.length < 10 ? 1 : 2;
    return best.error <= limit ? { ...best.tag, exact: best.error === 0 } : null;
  }

  function createTagCache(limit = 128) {
    const entries = new Map();
    function signature(image) {
      const bits = new Uint8Array(Math.ceil(image.width * image.height / 8));
      for (let i = 0; i < image.width * image.height; i++) {
        if (image.data[i * 4] < 128) bits[i >> 3] |= 1 << (i & 7);
      }
      let hash = 2166136261;
      for (const byte of bits) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
      return { key: `${image.width}:${image.height}:${hash}`, bits };
    }
    return {
      signature,
      get({ key, bits }) {
        const entry = entries.get(key);
        // Verify every packed pixel too: a hash collision must never select a tag.
        if (!entry || entry.bits.length !== bits.length || !bits.every((v, i) => v === entry.bits[i])) return;
        entries.delete(key); entries.set(key, entry);
        return entry.value;
      },
      set({ key, bits }, value) {
        entries.delete(key); entries.set(key, { bits: bits.slice(), value });
        if (entries.size > limit) entries.delete(entries.keys().next().value);
      },
    };
  }

  const api = { detectButtons, matchTag, normalize, createTagCache };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RecruitVision = api;
})(globalThis);

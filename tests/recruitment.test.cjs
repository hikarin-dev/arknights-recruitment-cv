const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rank } = require('../js/recruit-ranking.js');
const { matchTag, detectButtons, createTagCache } = require('../js/recruit-vision.js');

const group = (name, rarities) => ({ tags: [{ tagName: name }], matches: rarities.map(rarity => ({ rarity })) });

test('tag cache requires identical dimensions and packed pixels, including on hash collisions', () => {
  const cache = createTagCache();
  const image = { width: 8, height: 1, data: new Uint8Array(32).fill(255) };
  image.data[0] = 0;
  const a = cache.signature(image);
  cache.set(a, 'Guard');
  assert.equal(cache.get(cache.signature(image)), 'Guard');
  image.data[4] = 0;
  const b = cache.signature(image);
  assert.equal(cache.get(b), undefined);
  assert.equal(cache.get({ ...b, key: a.key }), undefined, 'hash collisions cannot select the wrong tag');
  assert.equal(cache.get(cache.signature({ ...image, width: 4, height: 2 })), undefined);
});

test('tag cache evicts the least recently used entry at its memory bound', () => {
  const cache = createTagCache(2);
  const a = { key: 'a', bits: new Uint8Array([1]) }, b = { key: 'b', bits: new Uint8Array([2]) }, c = { key: 'c', bits: new Uint8Array([3]) };
  cache.set(a, 'A'); cache.set(b, 'B');
  assert.equal(cache.get(a), 'A');
  cache.set(c, 'C');
  assert.equal(cache.get(b), undefined);
  assert.equal(cache.get(a), 'A');
  assert.equal(cache.get(c), 'C');
});

test('guaranteed 6 stars outrank 5, mixed 4/5, and 4; pool sizes do not imply odds', () => {
  const six = group('Top Operator', [5]);
  const five = group('Senior Operator', [4, 4]);
  const mixed = group('Mixed', [3, 4, 4, 4, 4]);
  const four = group('Four', [3]);
  assert.deepEqual(rank([four, five, mixed, six]).best, [six]);
  assert.deepEqual(rank([four, five, mixed]).best, [five]);
  assert.deepEqual(rank([four, mixed]).best, [mixed]);
  assert.deepEqual(rank([four]).best, [four]);
});

test('any 3-star outcome excludes a combination, even with many 5-star outcomes', () => {
  assert.equal(rank([group('Unsafe', [2, 4, 4, 4])]).best.length, 0);
  assert.equal(rank([group('Impossible', []), group('Robot', [0]), group('Starter', [1])]).best.length, 0);
});

test('9-hour pool excludes robots and starters, preserving equal-tier ties', () => {
  const a = group('A', [0, 3, 4]), b = group('B', [1, 3, 3, 4, 4]);
  assert.deepEqual(rank([a, b]).best, [a, b]);
  assert.deepEqual(rank([a]).candidates[0].eligible.map(op => op.rarity), [3, 4]);
});

test('OCR matching handles punctuation and bounded errors without forcing ambiguous or short words', () => {
  const tags = ['Fast-Redeploy', 'AoE', 'Guard', 'Support', 'Supporter', 'Medic', 'Melee'].map((tagName, tagId) => ({ tagName, tagId }));
  assert.equal(matchTag('Fast Redeploy\n', tags).tagName, 'Fast-Redeploy');
  assert.equal(matchTag('Supporler', tags).tagName, 'Supporter');
  assert.equal(matchTag('A0E', tags), null);
  assert.equal(matchTag('xxxxxxxxxxxx', tags), null);
  assert.equal(matchTag('', tags), null);
  assert.equal(matchTag('Guardx', [{ tagName: 'Guard' }, { tagName: 'Guards' }]), null);
});

test('CV requires a complete unique 3+2 grid and handles selected blue buttons', () => {
  const width = 700, height = 500;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  function rect(x, y, w, h, color = [51, 51, 51]) {
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) data.set([...color, 255], (py * width + px) * 4);
  }
  rect(80, 150, 100, 32); rect(200, 150, 100, 32, [0, 155, 210]); rect(320, 150, 100, 32);
  rect(80, 200, 100, 32); rect(200, 200, 100, 32);
  assert.equal(detectButtons({ width, height, data }).length, 5);
  rect(200, 200, 100, 32, [255, 255, 255]);
  assert.deepEqual(detectButtons({ width, height, data }), []);
});

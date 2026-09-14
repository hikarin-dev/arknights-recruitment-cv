# Arknights Recruitment CV

Arknights recruitment assistant with automatic tag recognition from screenshots
and screen sharing, plus highlights for the best guaranteed-rarity combinations.
Includes operator results, rarity filters, keyboard shortcuts, and EN, JP, KR,
and CN server selection.

Based on the recruitment calculator from
[akgcc/akgcc.github.io](https://github.com/akgcc/akgcc.github.io), adapted into a
standalone recruitment tool with browser-based image recognition. Original
copyright and MIT license notices are retained in `LICENSE`.

Open this repository in VS Code and click **Go Live** with the Live Server
extension installed. The port is configured in `.vscode/settings.json` (currently
**5005**). Visit http://localhost:5005/ to open the calculator directly.
If Live Server is already running, stop it and click Go Live again.

No build step or package installation is required. An internet connection is
needed for game data and operator portraits, which load from upstream sources.

## Screenshot input

Turn **Screenshot input** on, copy a recruitment screenshot, then click anywhere
on the background to paste it. Screenshot input is **off on the first visit**;
the browser remembers your selection for future visits. When enabled, it hides
and disables the manual tag picker and reset control even before an image is pasted.
Turn it off to return to manual input.

The fullscreen icon immediately after **Screenshot input** and **Screen share**
independently enters or exits fullscreen. Neither input toggle changes fullscreen.
Escape can also exit fullscreen; the icon updates to match. If fullscreen is
blocked, a hint appears and the calculator continues working normally.
Ctrl+V (Cmd+V on macOS) also accepts clipboard images. Buttons, links, inputs, and
operator cards keep their normal click behavior.

The screenshot fills the viewport background without changing its aspect ratio.
It is darkened to distinguish the website from the game; the five detected tag
buttons stay at their original brightness.
Five recognized tags are selected together, and their positions are outlined on
the screenshot. Gold outlines show one recommended combination at a time. When
several tie, **Highlight combination** selects which to outline; tied result rows
are all marked as recommended. Turn **Screenshot input** off to correct tags manually.
**Clear screenshot** removes the image while retaining selections and keeping the
manual picker disabled until screenshot input is turned off.
New screenshots are checked before anything is replaced. Only five confidently
recognized, distinct tags that differ from the previous set update the screenshot
and results. Same tags (including a different order) keep the existing image,
results, and chosen recommendation. Failed scans also leave previous input intact.
Both message boxes have reserved space so changing instructions or showing a
recommendation does not push the content below them down.

Recommendations assume **9:00 recruitment and that the selected tags stick**:

1. Guaranteed 6★.
2. Guaranteed 5★.
3. At least 4★, with 5★ possible.
4. Guaranteed 4★.

Equal tiers are ties. Actual recruitment rates are unavailable, so operator counts
are not treated as probability estimates. Screenshot results exclude any combination
that can yield 3★, even when **Show 2/3★** is enabled. Robots and starters are not
part of the 9-hour result pool. If nothing qualifies, the calculator says so.

Image processing runs entirely in the browser, with JavaScript and WebAssembly:

- Canvas downsamples for connected-component detection of the repeated 3+2 button
  grid, then crops and enlarges the original-resolution text. Detection uses button
  geometry, not hardcoded screenshot coordinates, and supports dark or blue buttons.
- [Tesseract.js 7.0.0](https://github.com/naptha/tesseract.js) loads only on first image
  use and runs in a reusable worker. Only the selected server's OCR language loads
  (English, Japanese, Korean, or simplified Chinese). Models are cached by the browser.
- Tag names are matched against the selected server's vocabulary, with conservative
  fuzzy matching and confidence checks. Images are not uploaded to an OCR service.

Canvas provides the small amount of CV needed here without loading the broader
[OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html) runtime.
First use needs internet access for the pinned OCR runtime and language model.
The browser may ask for clipboard permission; direct clipboard reads require
HTTPS or localhost. If click-to-paste is blocked, use Ctrl+V instead.

## Automatic screen sharing

Click **Screen share** in the top bar, choose the Arknights game/emulator window,
and click **Share** in the browser's picker. Open the recruitment screen in the
game: its screenshot and five tags update automatically, with the same dimming,
bright tag buttons, and recommendations as pasted screenshots. Choose the game
window itself so the capture does not include the calculator on top of it.

Once the five buttons are located, the tool tracks both their background colors
and letter shapes in five 128×40 crops, up to twenty times per second as capture
frames arrive. Comparing the text itself catches a single short tag changing even
when the average button color barely changes. Full-screen detection runs
when the grid is lost, when reacquiring a failed crop, on window switches, or about
every 750 ms to check geometry. An 80 ms timer covers still frames or unavailable video-frame
callbacks. Matching text must remain stable for at least 100 ms before recognition.
Even apparently unchanged text is rechecked about 750 ms after a successful read,
so a missed pixel transition cannot indefinitely suppress newer tags.

Capture tracking continues during OCR. If the game changes again, the unfinished
result is discarded and the newest stable grid is read next, without queuing
intermediate screenshots. Live pixels are checked again before applying a result.
Only five distinct, confidently recognized tags that differ from the last set
replace the screenshot and results. Opening another screen keeps the old input
available for reference.

OCR starts loading when you open the sharing picker. A bounded in-memory cache
reuses exact binary tag images previously read with high confidence; changing one
tag can reuse the other four. Hash matches are also checked against every packed
pixel. Full-resolution screenshots are encoded only when different tags have been
confirmed, and live captures reuse the detector's button coordinates instead of
running detection a second time. Failed reads retry after 200 ms, with increasing
delays capped at 1.6 seconds; different input resets the delay. The background is
a snapshot of the last recognized grid, not a continuous video.
Keep the game window open: capture of minimized windows can pause depending on
the browser and operating system.

Switching away from or returning to the calculator, changing tab visibility, or
resuming a paused capture triggers an immediate geometry and tag check, followed
by tag verification about every 250 ms for 1.5 seconds to catch delayed capture
frames. The website
can detect its own focus and visibility, but cannot monitor clicks in other apps
or determine which native app is active. Browser background throttling can still
delay checks, and first-use OCR model loading adds time. These intervals are
scheduling targets, not guaranteed response times.

Click **Stop sharing** to end capture and keep the last screenshot. The browser's
own **Stop sharing** button does the same. Switching to manual input, clearing the
screenshot, pasting an image, or leaving the page also stops capture. Stopping
capture does not exit fullscreen. While sharing, clicking the background forces
a fresh capture and tag search, bypassing cached recognition as a manual fallback.
If a read is already running, its result is discarded and the latest stable frame
is read next. Background clicks do not read the clipboard
while screen sharing is active.

This uses the browser's
[Screen Capture API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia).
The browser requires you to choose a capture source each time sharing starts;
the website cannot silently select the game window. Use a supported browser on
HTTPS or localhost. No audio is requested, and captured frames are processed
locally without recording or uploading the stream.

Both English examples in `sampleimg/` are tested, including half-size and letterboxed
variants. They have no qualifying 4★-or-better combination. Other layouts, heavily
compressed images, or obscured buttons can require manual correction. The selected
server should match the screenshot language.

## Verification

`node --test tests/recruitment.test.cjs` checks ranking, OCR matching, and grid detection.
For browser tests, run `npm install`, then `npm run test:browser` with Chrome installed.
Set `BROWSER_CHANNEL=msedge` to use Edge instead. Browser tests use a temporary port
and an isolated clipboard stub; they do not replace your system clipboard.
Screen-sharing tests use a canvas video stream and a simulated picker, so they
exercise real video-frame processing without capturing your desktop.

`npm run test:performance` measures capture-to-recognition scheduling using a real
canvas video stream with repeated single-tag changes. It reports timings and full
scan counts; OCR is stubbed in this benchmark to isolate capture overhead. The
browser suite separately checks real OCR, cache reuse, changing inputs during a
blocked recognition job, stale-result rejection, and failed-read retries.

Credits:

- https://github.com/Aceship/AN-EN-Tags
- https://github.com/ArknightsAssets/ArknightsGamedata
- https://github.com/Kengxxiao/ArknightsGameData
- https://github.com/akgcc/arkdata
- https://github.com/FortAwesome/Font-Awesome
- https://github.com/naptha/tesseract.js

Support the original developer on [GitHub](https://github.com/sponsors/NeverDecaf)
or [Ko-fi](https://ko-fi.com/NeverDecaf).

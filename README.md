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
**5005**). Visit http://localhost:5005/recruit/; the homepage also redirects there.
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

Once the five buttons are located, the tool watches tiny 16×8 color samples at
their positions (640 pixels total), up to ten times per second as capture frames
arrive. Changes trigger a full grid check; all five buttons changing color and
returning also trigger fresh validation. A full scan about once a second catches
subtle text changes or a moved grid. A 250 ms timer keeps checking when video-frame
callbacks are unavailable. Two matching grids at least 150 ms apart are required
before OCR; a transition alone never replaces the displayed screenshot.
Recognition runs one image
at a time and compares the recognized tag IDs before committing an update, so
animation or styling changes do not refresh the displayed input. If the recruitment
screen disappears, old selections, screenshots, and highlights remain available
for reference; if recognition fails, the tool retries after five seconds. The
background is a snapshot of the last recognized grid, not a continuous video.
Keep the game window open: capture of minimized windows can pause depending on
the browser and operating system.

Switching away from or returning to the calculator, changing tab visibility, or
resuming a paused capture triggers an immediate check. Checks during OCR are
combined into one follow-up, so they cannot build a processing queue. The website
can detect its own focus and visibility, but cannot monitor clicks in other apps
or determine which native app is active. Browser background throttling can still
delay checks, and first-use OCR model loading adds time. These intervals are
scheduling targets, not guaranteed response times.

Click **Stop sharing** to end capture and keep the last screenshot. The browser's
own **Stop sharing** button does the same. Switching to manual input, clearing the
screenshot, pasting an image, or leaving the page also stops capture. Stopping
capture does not exit fullscreen. Background clicks do not read the clipboard
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

Credits:

- https://github.com/Aceship/AN-EN-Tags
- https://github.com/ArknightsAssets/ArknightsGamedata
- https://github.com/Kengxxiao/ArknightsGameData
- https://github.com/akgcc/arkdata
- https://github.com/FortAwesome/Font-Awesome
- https://github.com/naptha/tesseract.js

Support the original developer on [GitHub](https://github.com/sponsors/NeverDecaf)
or [Ko-fi](https://ko-fi.com/NeverDecaf).

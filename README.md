# SimpleVastPlayer

A minimal, iframe-based VAST player built on the Google IMA SDK, to help user quickly start with implementation of VAST ad on their web page, without the hurdle of understanding IMA SDK details.  It targets desktop environments and is compatible with ES3/ES5-era browsers (circa 2015). The player creates a friendly iframe that loads IMA inside, auto-play the ad inside the iframe with proper dimensions, and provide key VAST lifecycle events callbacks to your page.

- Desktop-only
- No external bundlers required
- Autoloads Google IMA SDK inside the iframe
- Supports VAST tag URLs and raw VAST XML strings
- Simple event callbacks for impression and quartiles
- Easy to embedded in existing pages via a container DIV

## Requirements

- A desktop browser with basic ES5 support.
- Network access to the Google IMA SDK (loaded inside the ad iframe):
  - https://imasdk.googleapis.com/js/sdkloader/ima3.js

Note: The parent page does not need to load IMA; it is injected into the iframe by the player.

## Installation

Include `simplevastplayer.js` on your page (via local file or your preferred hosting path):

```html
<script src="simplevastplayer.js"></script>
```

## Quick start

Drop a container element into your page, attach callbacks, and start an ad:

```html
<div id="ad-slot1"></div>
<script src="simplevastplayer.js"></script>
<script>
  var slot1 = document.getElementById('ad-slot1');
  var svp = new SimpleVastPlayer();

  svp.onError(function (ns, err) {
    // cleanup z-index etc. here
    console.log(ns + 'Ad error:', err && err.message);
  })
  .onSuccess(function (ns) {
    // cleanup z-index etc. here
    console.log(ns + 'Ad success');
  })
  .onImpression(function (ns) {
    console.log(ns + 'VAST Impression');
  })
  .onQ0(function (ns) {
    console.log(ns + 'VAST start');
  })
  .onQ25(function (ns) {
    console.log(ns + 'VAST 25%');
  })
  .onQ50(function (ns) {
    console.log(ns + 'VAST 50%');
  })
  .onQ75(function (ns) {
    console.log(ns + 'VAST 75%');
  })
  .onQ100(function (ns) {
    console.log(ns + 'VAST complete');
  });

  // PlayAd: pass a VAST tag URL OR a raw VAST XML string
  svp.playAd(
    "https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_ad_samples&sz=640x480&cust_params=sample_ct%3Dlinear&ciu_szs=300x250%2C728x90&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&correlator=", // ad tag URL or raw VAST XML
    slot1,  // container DIV for the ad iframe
    640, 360, // width, height of the ad iframe
    30 // optional timeout seconds
  );

  // Play another ad using the same svp instance after 30 seconds
  setTimeout(function () {
    svp.playAd(
      "https://opencdn.b-cdn.net/pub/5.0/e-a-1/vast_adpods_sample2.xml?token=59914261",
      slot1,
      640, 360
    );
  }, 30000);
</script>
```

## How it works (high level)

- The API constructs a friendly iframe and injects a minimal HTML document.
- The iframe loads and initializes the Google IMA SDK and loads the ad and play the ad.
- Events and errors are posted back to the parent via `postMessage`.
- The API manages timeouts, cleanup, and your callback hooks.
- Only linear, non-audio-only ads are supported. If a non-linear or audio-only ad is returned, the API triggers an error.
- On success or error, the API removes the iframe from the DOM and resets internal states.
- You can call `playAd` again on the same instance to load a new ad (even into the same container). If an ad is still playing while you call the `playAd` on the same instance, it will trigger an error and abort the current ad.


## API

### Constructor

```js
var svp = new SimpleVastPlayer();
```

Each instance uses an internal namespace to correlate messages from its iframe.

### Methods

- `playAd(vastOrTagUrlOrXml, containerEl, widthPx, heightPx, timeoutSec?)`
  - `vastOrTagUrlOrXml` (string): Either a VAST ad tag URL (http/https) or a raw VAST XML string. If it starts with `http` or `https`, it's treated as an ad tag URL; otherwise it's used as raw VAST XML.
  - `containerEl` (HTMLElement): The parent DOM element to receive the ad iframe.
  - `widthPx` (number): Iframe width in pixels.
  - `heightPx` (number): Iframe height in pixels.
  - `timeoutSec` (number, optional): If provided and > 0, the player will abort and call `onError` after this many seconds if the ad doesn't complete initialization/playback.

- Event registration (chainable):
  - `onError(fn)` — Invoked on any error (including timeouts or ad loading/playback errors).
  - `onSuccess(fn)` — Invoked when all ads are successfully played.
  - `onImpression(fn)` — Invoked on VAST `IMPRESSION` event.
  - `onQ0(fn)` — Invoked on VAST `STARTED` event (linear only).
  - `onQ25(fn)` — Invoked on VAST `FIRST_QUARTILE` event.
  - `onQ50(fn)` — Invoked on VAST `MIDPOINT` event.
  - `onQ75(fn)` — Invoked on VAST `THIRD_QUARTILE` event.
  - `onQ100(fn)` — Invoked on VAST `COMPLETE` event.

All event callbacks receive:
- `namespace` (string): A instance identifier, useful for logging.
- `error` (object, only for `onError`): Shape `{ message: string }` at minimum.

Example:

```js
svp.onError(function (ns, err) {
  console.log(ns, 'Error:', err && err.message);
}).onSuccess(function (ns) {
  console.log(ns, 'All ads completed');
});
```

## Examples

### 1) Using a VAST tag URL

```js
var svp = new SimpleVastPlayer();
svp.onImpression(function (ns) {
  console.log('Impression', ns);
}).onQ100(function (ns) {
  console.log('Complete', ns);
}).onError(function (ns, err) {
  console.warn('Ad error', ns, err && err.message);
});

svp.playAd(
  'https://example.com/path/to/vast/tag',
  document.getElementById('ad-slot'),
  640, 360,
  20 // timeout seconds
);
```

### 2) Using a raw VAST XML string

```js
var vastXml = '<VAST version="3.0"> ... </VAST>';
var svp = new SimpleVastPlayer();
svp.onSuccess(function (ns) { console.log('Done', ns); });

svp.playAd(
  vastXml,
  document.getElementById('ad-slot'),
  640, 360
);
```

### 3) Sequencing multiple ad calls (reuse the same instance)

```js
var svp = new SimpleVastPlayer();
function play(tag) {
  svp.playAd(tag, document.getElementById('ad-slot'), 640, 360, 30);
}
svp.onError(function (ns, err) {
  console.log('Ad failed:', err && err.message);
});
svp.onSuccess(function () {
  console.log('First ad completed, starting next...');
  play('https://example.com/second-ad-tag');
});

play('https://example.com/first-ad-tag');
```

## License

MIT license

(function (wind) {
	// SimpleVastPlayer: minimal iframe-based VAST player using Google IMA SDK
	// Desktop-only, ES3/ES5-era compatible (circa 2015).
	// API:
	//   playAd(vastOrTagUrlOrXml, containerDiv, widthPx, heightPx, timeoutSec?)
	//   onError(fn), onSuccess(fn), onImpression(fn), onQ0(fn), onQ25(fn), onQ50(fn), onQ75(fn), onQ100(fn)
	//

	var MSG_PREFIX = 'svp';

	function whenAvail(rootEl, name, callback) {
		function check(path, root) {
			var e = root;
			var spa = path.split('.');
			for (var i = 0, len = spa.length; i < len; i++) {
				if (e) {
					e = e[spa[i]];
				}
			}
			return e !== undefined && e !== null;
		}
		var iid = window.setInterval(function() {
			if (check(name, rootEl)) {
				window.clearInterval(iid);
				callback();
			}
		}, 50);
	}

	// -------------------------------------------------------------
	// IFRAME BOOTSTRAP FUNCTION (lives in parent, runs in iframe)
	// -------------------------------------------------------------
	function SimpleVastPlayer_iframe(doc, win, namespace) {

		function post(type, data) {
			try { win.parent.postMessage(namespace + JSON.stringify({ type: type, data: data || {} }), '*'); } catch (e) {}
		}

		var aborted = false;
		var adsLoader = null, adsManager = null, adDisplayContainer = null;
	
		var root = doc.getElementById('root');
		var video = doc.getElementById('contentVideo');
		var adContainerEl = doc.getElementById('adContainer');

		// --- SIZING: force pixel-exact match to the actual iframe element ---
		var lastW = 0, lastH = 0;
		function ensureSizeAndMaybeResizeIMA() {
			function measureIframeSize() {
				var fe = win.frameElement;
				var w = 0, h = 0;
				if (fe) {
					w = fe.clientWidth || fe.offsetWidth || 0;
					h = fe.clientHeight || fe.offsetHeight || 0;
				}
				if (!w || !h) {
					var de = doc.documentElement; var b = doc.body;
					w = win.innerWidth || (de && de.clientWidth) || (b && b.clientWidth) || 640;
					h = win.innerHeight || (de && de.clientHeight) || (b && b.clientHeight) || 360;
				}
				return { w: w, h: h };
			}
			function applySize(w, h) {
				try {
					doc.documentElement.style.width = '100%';
					doc.documentElement.style.height = '100%';
					doc.body.style.width = '100%';
					doc.body.style.height = '100%';
					doc.body.style.margin = '0';
					doc.body.style.padding = '0';
					root.style.position = 'relative';
					root.style.width = w + 'px';
					root.style.height = h + 'px';
					adContainerEl.style.position = 'absolute';
					adContainerEl.style.left = '0px';
					adContainerEl.style.top = '0px';
					adContainerEl.style.width = '100%';
					adContainerEl.style.height = '100%';
					video.style.display = 'block';
					video.style.width = '100%';
					video.style.height = '100%';
					video.style.background = '#000';
				} catch (e) {}
			}
		
			var m = measureIframeSize();
			if (m.w !== lastW || m.h !== lastH) {
				lastW = m.w; lastH = m.h;
				applySize(m.w, m.h);
				try { if (adsManager) { adsManager.resize(m.w, m.h, google.ima.ViewMode.NORMAL); } } catch (e) {}
			}
		}
		function slotW() { return adContainerEl.clientWidth || root.clientWidth || lastW || 640; }
		function slotH() { return adContainerEl.clientHeight || root.clientHeight || lastH || 360; }

		// Prevent fullscreen / force mute
		try { video.controls = false; video.setAttribute('controls', false); } catch (e) {}
		try { video.requestFullscreen = function () {}; video.webkitRequestFullscreen = function () {}; video.mozRequestFullScreen = function () {}; } catch (e) {}
		video.muted = true; try { video.setAttribute('muted', 'muted'); } catch (e) {}

		function startIMA(input) {
			if (aborted) return;
			try { adDisplayContainer = new win.google.ima.AdDisplayContainer(adContainerEl, video); } catch (e) { post('error', { message: 'IMA init failed' }); return; }
			try { adDisplayContainer.initialize(); } catch (e) {}
			adsLoader = new win.google.ima.AdsLoader(adDisplayContainer);

			var adsRequest = new win.google.ima.AdsRequest();
			if (/^https?:\/\//i.test(input)) {
				adsRequest.adTagUrl = input;
			} else {
				adsRequest.adsResponse = input;
			}

			adsRequest.linearAdSlotWidth = slotW();
			adsRequest.linearAdSlotHeight = slotH();
			adsRequest.nonLinearAdSlotWidth = 0;
			adsRequest.nonLinearAdSlotHeight = 0;
			adsRequest.setAdWillAutoPlay = adsRequest.setAdWillAutoPlay || function () {};
			adsRequest.setAdWillPlayMuted = adsRequest.setAdWillPlayMuted || function () {};
			try { adsRequest.setAdWillAutoPlay(true); adsRequest.setAdWillPlayMuted(true); } catch (e) {}

			var renderSettings = new win.google.ima.AdsRenderingSettings();
			renderSettings.restoreCustomPlaybackStateOnAdBreakComplete = true;

			adsLoader.addEventListener(win.google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, function (e) {
				if (aborted) return;
				try { adsManager = e.getAdsManager(video, renderSettings); } catch (e) { post('error', { message: 'getAdsManager failed' }); return; }
				try { adsManager.setVolume(0); } catch (e) {}

				var AdEvent = win.google.ima.AdEvent.Type;
				function isLinear(ev) { try { return ev.getAd() && ev.getAd().isLinear(); } catch (e) { return false; } }
				function isAudioOnly(ev) { try { var ad = ev.getAd(); var ct = ad && ad.getContentType && ad.getContentType(); return !!(ct && ct.indexOf('audio') === 0); } catch (e) { return false; } }
				function ignoreIfNotLinear(ev) { if (!isLinear(ev) || isAudioOnly(ev)) { try { adsManager.destroy(); } catch (e) {} post('error', { message: 'Non-linear or audio-only ad ignored' }); } }

				adsManager.addEventListener(AdEvent.IMPRESSION, function () { post('impression'); });
				adsManager.addEventListener(AdEvent.STARTED, function (ev) { if (!isLinear(ev)) { ignoreIfNotLinear(ev); return; } post('quartile', { value: 0 }); });
				adsManager.addEventListener(AdEvent.FIRST_QUARTILE, function (ev) { if (!isLinear(ev)) { ignoreIfNotLinear(ev); return; } post('quartile', { value: 25 }); });
				adsManager.addEventListener(AdEvent.MIDPOINT, function (ev) { if (!isLinear(ev)) { ignoreIfNotLinear(ev); return; } post('quartile', { value: 50 }); });
				adsManager.addEventListener(AdEvent.THIRD_QUARTILE, function (ev) { if (!isLinear(ev)) { ignoreIfNotLinear(ev); return; } post('quartile', { value: 75 }); });
				adsManager.addEventListener(AdEvent.COMPLETE, function (ev) { if (!isLinear(ev)) { ignoreIfNotLinear(ev); return; } post('quartile', { value: 100 }); });
				adsManager.addEventListener(AdEvent.ALL_ADS_COMPLETED, function () { post('success'); });

				var AdErrorEvent = win.google.ima.AdErrorEvent.Type;
				adsManager.addEventListener(AdErrorEvent.AD_ERROR, function (er) { post('error', { message: (er && er.getError && er.getError().toString()) || 'Ad error' }); });

				try { adsManager.init(slotW(), slotH(), win.google.ima.ViewMode.NORMAL); } catch (e) {}
				try { adsManager.start(); } catch (e) { post('error', { message: 'AdsManager.start failed' }); }
			}, false);

			adsLoader.addEventListener(win.google.ima.AdErrorEvent.Type.AD_ERROR, function (e) {
				post('error', { message: (e && e.getError && e.getError().toString()) || 'Ad error' });
				try { if (adsManager) { adsManager.destroy(); } } catch (e) {}
			}, false);

			try { adsLoader.requestAds(adsRequest); } catch (e) { post('error', { message: 'requestAds failed' }); }
		}

		function onParentMessage(evt) {
			try {
				var d = evt && typeof evt.data === 'string' ? evt.data : null; if (!d || d.indexOf(namespace) !== 0) return;
				var msg = JSON.parse(d.substr(namespace.length)); if (!msg || !msg.type) return;
				if (msg.type === 'abort') { aborted = true; try { if (adsManager) { adsManager.destroy(); } } catch (e) {} }
				else if (msg.type === 'start') { ensureSizeAndMaybeResizeIMA(); startIMA(msg.input); }
			} catch (e) {}
		}

		if (win.addEventListener) win.addEventListener('message', onParentMessage, false);
		else if (win.attachEvent) win.attachEvent('onmessage', onParentMessage);

		// Boot sizing
		ensureSizeAndMaybeResizeIMA();

		// Signal readiness to parent
		post('ready');
	}

	// -------------------------------------------------------------
	// PARENT-SIDE CONTROLLER
	// -------------------------------------------------------------
	function SimpleVastPlayer() {
		var self = this;
	
		var state = { container: null, vast: null, timeoutSec: null, iframe: null, timerId: null};

		var cb = {names:["error","success","impression","q0","q25","q50","q75","q100"]};
		for (var i=0;i<cb.names.length; i++) {
			(function(nm){ cb[nm]=function(){}; self["on"+nm.charAt(0).toUpperCase()+nm.slice(1)]=function(fn){ if ((typeof fn)==='function') { cb[nm] = fn; } return self; };})(cb.names[i]);
		}
		delete cb.names;

		this.namespace = MSG_PREFIX+'-'+(Math.random()).toString(36).slice(-8)+':';

		function onMessage(evt) {
			if (!evt || typeof evt.data !== 'string') return;
			if (evt.data.indexOf(self.namespace) !== 0) return;
			var payloadStr = evt.data.substring(self.namespace.length);
			var msg; try { msg = JSON.parse(payloadStr); } catch (e) { return; }
			if (!msg || !msg.type) return;
	
			if (msg.type === 'load') {
				state.iframe.contentWindow.SimpleVastPlayer_iframe = SimpleVastPlayer_iframe;
			} else if (msg.type === 'ready') {
				msgIframe({ type: 'start', input: state.vast });
			} else if (msg.type === 'impression') {
				cb.impression(self.namespace);
			} else if (msg.type === 'quartile') {
				var v = msg.data && msg.data.value;
				if (('q'+v) in cb) { cb['q'+v](self.namespace); }
			} else if (msg.type === 'success') {
				clearTimeoutTimer(); cb.success(self.namespace); cleanup();
			} else if (msg.type === 'error') {
				handleError(msg.data || { message: 'Unknown error from iframe' });
			}
		}
	
		function attachMessageListener() { if (wind.addEventListener) wind.addEventListener('message', onMessage, false); else if (wind.attachEvent) wind.attachEvent('onmessage', onMessage); }
		function detachMessageListener() { if (wind.removeEventListener) wind.removeEventListener('message', onMessage, false); else if (wind.detachEvent) wind.detachEvent('onmessage', onMessage); }
	
		function msgIframe(obj) { try { if (state.iframe && state.iframe.contentWindow && obj) { state.iframe.contentWindow.postMessage(self.namespace + JSON.stringify(obj), '*'); } } catch (e) {} }
	
		function handleError(err) { clearTimeoutTimer(); cb.error(self.namespace, err || { message: 'Unknown error' }); cleanup(); }
	
		function clearTimeoutTimer() { if (state.timerId) { try { clearTimeout(state.timerId); } catch (e) {} state.timerId = null; } }
		function resetTimeoutTimer() { clearTimeoutTimer(); if (!state.timeoutSec) return; state.timerId = setTimeout(function () { msgIframe({ type: 'abort' }); handleError({ message: 'Ad timeout after ' + state.timeoutSec + 's' }); }, state.timeoutSec * 1000); }
	
		function cleanup() {
			detachMessageListener();
			clearTimeoutTimer();
			try { if (state.iframe && state.iframe.parentNode) { state.iframe.parentNode.removeChild(state.iframe); } } catch (e) {}
			state.container = null;
			state.vast = null;
			state.timeoutSec = null;
			state.iframe = null;
		}
	
		this.playAd = function (vastOrTagUrl, containerEl, playerWidth, playerHeight, timeoutSec) {
			if (!containerEl || !containerEl.appendChild) { handleError({ message: 'Invalid container element' }); return; }
			if (!vastOrTagUrl || typeof vastOrTagUrl !== 'string') { handleError({ message: 'Invalid VAST input' }); return; }
			if (!playerWidth || !playerHeight) { handleError({ message: 'Invalid player dimensions' }); return; }
			
			// clean up previous ad call residues
			if (state.container) { cleanup(); }
			
			state.container = containerEl;
			state.vast = vastOrTagUrl;
			state.timeoutSec = typeof timeoutSec === 'number' && timeoutSec > 0 ? timeoutSec : null;
			if (state.timeoutSec) { resetTimeoutTimer(); }
			
			attachMessageListener();
			
			// Create friendly iframe sized by caller
			var ifr = document.createElement('iframe');
			ifr.setAttribute('frameborder', '0');
			ifr.setAttribute('allow', 'autoplay');
			ifr.style.width = playerWidth + 'px';
			ifr.style.height = playerHeight + 'px';
			ifr.style.border = '0';
			ifr.style.display = 'block';
			ifr.style.background = '#000';
			
			state.container.appendChild(ifr);
			state.iframe = ifr;
			
			whenAvail(ifr, 'contentWindow.document', function(){
				// Build minimal HTML with encoding; actual code comes from parent SimpleVastPlayer_iframe
				var doc = ifr.contentWindow.document; try { doc.open(); } catch (e) {}
				var html = '' +
					'<!doctype html><html><head>\n' +
					'<meta charset="utf-8">\n' +
					'<meta http-equiv="X-UA-Compatible" content="IE=edge" />\n' +
					'<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
					'<style>html,body{margin:0;padding:0;background:#000;overflow:hidden;width:100%;height:100%;}#root{position:relative;width:100%;height:100%;}video{width:100%;height:100%;background:#000;display:block}#adContainer{position:absolute;left:0;top:0;width:100%;height:100%;}</style>\n' +
					'<script src="https://imasdk.googleapis.com/js/sdkloader/ima3.js"><\/script>\n' +
					'</head><body>\n' +
					'<div id="root">\n' +
					'  <video id="contentVideo" muted playsinline webkit-playsinline preload="auto"></video>\n' +
					'  <div id="adContainer"></div>\n' +
					'</div>\n' +
					'<script type="text/javascript">\n' +
					'var initId = setInterval(function(){if(SimpleVastPlayer_iframe){clearInterval(initId);SimpleVastPlayer_iframe(document,window,"'+self.namespace+'");return;}},50);' +
					'parent.postMessage(\''+self.namespace+'{"type":"load"}\',"*");' +
					'<\/script>\n' +
					'</body></html>';
				try { doc.write(html); doc.close(); } catch (e) { handleError({ message: 'Failed to write iframe document' }); return; }
			});
		};
	
		return this;
	}
	
	wind.SimpleVastPlayer = SimpleVastPlayer;
})(window);

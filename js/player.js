/**
 * player.js — Wrapper hls.js + <video> nativo da TV.
 *
 * Tenta na ordem:
 *   1) HLS nativo do <video> (webOS 4+ suporta application/vnd.apple.mpegurl)
 *   2) hls.js (fallback universal)
 *   3) <video src> direto (não-HLS, ex.: MP4)
 *
 * Auto-recuperação de erro (NETWORK = recarrega, MEDIA = recoverMediaError).
 * Watchdog: se não começar a tocar em 35s, marca canal como morto.
 */
(function (global) {
  'use strict';

  var hls = null;
  var stallTimer = null;
  var startedRef = false;
  var deadCalled = false;
  var currentVideo = null;
  var onErrorCb = null;
  var onPlayingCb = null;
  var onLoadingCb = null;
  var onDeadCb = null;

  function destroy() {
    clearTimeout(stallTimer);
    stallTimer = null;
    if (hls) {
      try { hls.detachMedia(); } catch (_) {}
      try { hls.destroy(); } catch (_) {}
      hls = null;
    }
    if (currentVideo) {
      try { currentVideo.pause(); } catch (_) {}
      try {
        currentVideo.removeAttribute('src');
        currentVideo.load();
      } catch (_) {}
    }
    startedRef = false;
    deadCalled = false;
  }

  function callOnce(fn) {
    var done = false;
    return function () {
      if (done) return;
      done = true;
      try { fn.apply(null, arguments); } catch (_) {}
    };
  }

  /**
   * Toca uma URL de stream no elemento <video>.
   * opts: { onError, onPlaying, onLoading, onDead }
   */
  function play(videoEl, url, opts) {
    opts = opts || {};
    destroy(); // limpa o canal anterior

    currentVideo = videoEl;
    onErrorCb = opts.onError || function () {};
    onPlayingCb = opts.onPlaying || function () {};
    onLoadingCb = opts.onLoading || function () {};
    onDeadCb = callOnce(opts.onDead || function () {});

    onLoadingCb();

    // Watchdog: se não tocar em 35s, é canal morto.
    stallTimer = setTimeout(function () {
      if (!startedRef) {
        onErrorCb('Canal fora do ar no momento.');
        if (!deadCalled) { deadCalled = true; onDeadCb(); }
      }
    }, 35000);

    // Vincula eventos do <video> (uma vez por play)
    var v = videoEl;
    v.onplaying = function () {
      startedRef = true;
      clearTimeout(stallTimer);
      // Religa o som quando começa a tocar (autoplay precisa começar mudo)
      try { v.muted = false; } catch (_) {}
      onPlayingCb();
    };
    v.oncanplay = function () { /* opcional */ };
    v.onerror = function () {
      onErrorCb('Erro ao tocar o canal.');
      if (!deadCalled) { deadCalled = true; onDeadCb(); }
    };

    // Mute primeiro pra contornar política de autoplay
    try { v.muted = true; } catch (_) {}

    var startPlay = function () {
      var p = v.play();
      if (p && typeof p.then === 'function') {
        p.catch(function () {
          // Alguns players retornam Promise rejeitada se a TV pedir interação;
          // o evento 'playing' ainda dispara depois quando funciona.
        });
      }
    };

    // 1) HLS nativo (webOS 4+, Tizen, Android TV ChromeCast)
    var canNative = false;
    try { canNative = v.canPlayType && v.canPlayType('application/vnd.apple.mpegurl') !== ''; } catch (_) {}

    if (canNative && /\.m3u8(\?|$)/i.test(url)) {
      v.src = url;
      startPlay();
      return;
    }

    // 2) hls.js
    if (typeof Hls !== 'undefined' && Hls.isSupported && Hls.isSupported() && /\.m3u8(\?|$)/i.test(url)) {
      hls = new Hls({
        enableWorker: false,
        lowLatencyMode: false,
        backBufferLength: 30,
        autoStartLoad: true,
        startLevel: -1,
        manifestLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 4,
        levelLoadingTimeOut: 20000,
        fragLoadingTimeOut: 30000,
        fragLoadingMaxRetry: 6
      });
      hls.loadSource(url);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, function () {
        try { hls.startLoad(); } catch (_) {}
        startPlay();
      });
      hls.on(Hls.Events.ERROR, function (_evt, data) {
        if (!data || !data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          try { hls.startLoad(); } catch (_) {}
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          try { hls.recoverMediaError(); } catch (_) {}
        } else {
          onErrorCb('Não foi possível tocar este canal.');
          if (!deadCalled) { deadCalled = true; onDeadCb(); }
          try { hls.destroy(); } catch (_) {}
        }
      });
      return;
    }

    // 3) Último recurso: tentar direto (MP4, WebM, etc.)
    v.src = url;
    startPlay();
  }

  global.MeflyPlayer = {
    play: play,
    stop: destroy
  };
})(window);

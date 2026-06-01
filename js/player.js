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
  var currentUrl = null;
  var onErrorCb = null;
  var onPlayingCb = null;
  var onLoadingCb = null;
  var onDeadCb = null;
  // Vigia anti-congelamento: monitora se o vídeo está REALMENTE avançando.
  var watchdog = null;
  var lastTime = 0;
  var frozenTicks = 0;
  var recovering = 0; // nº de tentativas de auto-recuperação no canal atual

  function destroy() {
    clearTimeout(stallTimer);
    stallTimer = null;
    stopWatchdog();
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
    recovering = 0;
  }

  function stopWatchdog() { if (watchdog) { clearInterval(watchdog); watchdog = null; } }

  // Liga o vigia: a cada 3s confere se o currentTime avançou. Se ficar parado
  // ~9s (3 ticks) com o canal supostamente tocando, tenta religar o stream.
  function startWatchdog() {
    stopWatchdog();
    lastTime = 0; frozenTicks = 0;
    watchdog = setInterval(function () {
      if (!currentVideo) return;
      if (currentVideo.paused) return; // pausa intencional não conta
      var t = currentVideo.currentTime || 0;
      if (t > lastTime + 0.2) { lastTime = t; frozenTicks = 0; return; }
      // não avançou
      frozenTicks++;
      if (frozenTicks >= 3) {
        frozenTicks = 0;
        tryRecover();
      }
    }, 3000);
  }

  // Tenta recuperar um stream travado SEM trocar de canal. Até 3 tentativas;
  // se não voltar, marca como indisponível.
  function tryRecover() {
    if (!currentVideo || !currentUrl) return;
    recovering++;
    if (recovering > 3) {
      onErrorCb('Sinal instável. Tente outro canal ou volte mais tarde.');
      stopWatchdog();
      return;
    }
    onLoadingCb();
    try {
      if (hls) {
        // hls.js: recarrega a fonte do zero
        hls.stopLoad();
        hls.startLoad();
        var p = currentVideo.play(); if (p && p.catch) p.catch(function () {});
      } else {
        // nativo: recarrega o src
        var pos = currentVideo.currentTime;
        currentVideo.load();
        var p2 = currentVideo.play(); if (p2 && p2.catch) p2.catch(function () {});
      }
    } catch (_) {}
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
    currentUrl = url;
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
      recovering = 0; // tocou de novo → zera contador de recuperação
      // Religa o som quando começa a tocar (autoplay precisa começar mudo)
      try { v.muted = false; } catch (_) {}
      onPlayingCb();
      startWatchdog(); // começa a vigiar congelamento
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

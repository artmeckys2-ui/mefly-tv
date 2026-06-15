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
  // Contadores de erro: deixamos o canal tomar uma trombadinha de rede ou um
  // erro de mídia ANTES de chamar fatal. A grande maioria dos "erros" em IPTV
  // é só um fragmento .ts que falhou — a hls.js só precisa retomar.
  var netErrors = 0;
  var mediaErrors = 0;
  var MAX_NET = 4;     // até 4 falhas de rede consecutivas → fatal
  var MAX_MEDIA = 2;   // até 2 erros de mídia → fatal

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
    netErrors = 0;
    mediaErrors = 0;
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

  // Tenta recuperar um stream travado SEM trocar de canal. Até 5 tentativas
  // antes de desistir — a maioria das "quedinhas" volta dentro disso.
  function tryRecover() {
    if (!currentVideo || !currentUrl) return;
    recovering++;
    if (recovering > 5) {
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

    // Watchdog inicial: se não tocar NUNCA em 15s, é canal morto.
    // (Antes era 35s — muito longo. 15s + os retries internos da hls.js já
    // dão tempo suficiente pra um stream lento responder.)
    stallTimer = setTimeout(function () {
      if (!startedRef) {
        onErrorCb('Canal fora do ar no momento.');
        if (!deadCalled) { deadCalled = true; onDeadCb(); }
      }
    }, 15000);

    // Vincula eventos do <video> (uma vez por play)
    var v = videoEl;
    v.onplaying = function () {
      startedRef = true;
      clearTimeout(stallTimer);
      recovering = 0; // tocou de novo → zera contador de recuperação
      netErrors = 0; mediaErrors = 0; // tocou de novo → zera contadores de erro
      // Religa o som quando começa a tocar (autoplay precisa começar mudo)
      try { v.muted = false; } catch (_) {}
      onPlayingCb();
      startWatchdog(); // começa a vigiar congelamento

      // BLACK-SCREEN GUARD: 4s depois de começar a tocar, confere se realmente
      // tem vídeo (videoWidth > 0). Se só áudio sai, é codec não decodificável
      // (HEVC/AV1 que escapou dos guards) — sinaliza erro pra cair no swap.
      setTimeout(function () {
        if (!currentVideo || currentVideo !== v) return;
        if (v.paused || v.ended) return;
        var w = v.videoWidth || 0, h = v.videoHeight || 0;
        if (w === 0 || h === 0) {
          console.warn('[mefly] sem vídeo após 4s — só áudio. Trocando…');
          onErrorCb('Sem vídeo (só áudio) — tentando outra fonte.');
          if (!deadCalled) { deadCalled = true; onDeadCb(); }
        }
      }, 4000);
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

    var isHlsUrl = /\.m3u8(\?|$)/i.test(url);
    var isDirectFile = /\.(mp4|m4v|webm|mkv|ogg|ogv)(\?|$)/i.test(url);
    var hlsJsOk = (typeof Hls !== 'undefined' && Hls.isSupported && Hls.isSupported());

    // PLATAFORMAS COM HLS NATIVO CONFIÁVEL.
    // Pegadinha do Chromium (WebView do Android / Chrome): v.canPlayType(
    // 'application/vnd.apple.mpegurl') devolve "maybe", MAS o Chromium NÃO
    // toca HLS nativo de verdade. Se confiarmos nesse "maybe", o .m3u8 vai
    // direto pro v.src e dispara "Erro ao tocar o canal". Por isso só
    // confiamos no nativo em webOS (LG), Tizen e Safari/iOS — onde realmente
    // funciona. Em todo o resto, hls.js é o caminho.
    var ua = (navigator.userAgent || '').toLowerCase();
    var trustyNative = (ua.indexOf('web0s') !== -1 || ua.indexOf('webos') !== -1 ||
                        ua.indexOf('tizen') !== -1 ||
                        /(iphone|ipad|ipod)/.test(ua) ||
                        (/safari/.test(ua) && ua.indexOf('chrome') === -1 && ua.indexOf('android') === -1));
    var canNative = false;
    try { canNative = trustyNative && v.canPlayType && v.canPlayType('application/vnd.apple.mpegurl') !== ''; } catch (_) {}

    // 1) HLS nativo — só nas plataformas confiáveis (LG/webOS, Tizen, Safari/iOS)
    if (canNative && isHlsUrl) {
      v.src = url;
      startPlay();
      return;
    }

    // 2) hls.js — caminho universal (Chrome, WebView do Android e afins).
    //    Cobre .m3u8 e, fora das plataformas nativas, também HLS sem extensão
    //    (.m3u8 atrás de proxy/token), que antes morria caindo no v.src direto.
    if (hlsJsOk && (isHlsUrl || (!trustyNative && !isDirectFile))) {
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
      hls.on(Hls.Events.MANIFEST_PARSED, function (_evt, data) {
        // CODEC GUARD (variantes do master playlist): só aceita níveis cujo
        // codec o <video> declara saber tocar. NÃO rejeita níveis com codec
        // desconhecido — só rejeita os explicitamente HEVC/AV1 quando a TV
        // não decodifica.
        try {
          var levels = (data && data.levels) || [];
          if (levels.length > 1) {
            var canPlay = function (l) {
              if (!l) return false;
              var vc = (l.videoCodec || (l.attrs && l.attrs.CODECS) || '').toLowerCase();
              var hasVideo = !!l.videoCodec || (l.width && l.width > 0);
              // Audio-only puro
              if (!hasVideo && !vc) return false;
              if (/hvc1|hev1|h265/.test(vc)) {
                try { if (!v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"')) return false; } catch (_) { return false; }
              }
              if (/av01/.test(vc)) {
                try { if (!v.canPlayType('video/mp4; codecs="av01.0.05M.08"')) return false; } catch (_) { return false; }
              }
              return true;
            };
            var supported = [];
            for (var i = 0; i < levels.length; i++) if (canPlay(levels[i])) supported.push(i);
            if (supported.length && supported.indexOf(0) === -1) {
              // O nível default (0) é incompatível mas tem outros — força o 1º compatível
              hls.startLevel = supported[0];
              hls.currentLevel = supported[0];
            }
          }
        } catch (_) {}
        try { hls.startLoad(); } catch (_) {}
        startPlay();
      });

      // CODEC GUARD 2 (pós-demux): mesmo com 1 só nível e sem CODECS no
      // manifest, depois que o hls.js demuxa o primeiro segmento .ts, ele
      // anuncia QUAL codec foi detectado dentro do container. Aqui sim
      // pegamos o caso ESPN: stream sem variantes, vídeo HEVC, áudio AAC —
      // pra TV/Chromium sai como "audio toca, tela preta". Detectamos e
      // sinalizamos erro pra cair no twin-swap automático (ESPN→ESPN 2…).
      hls.on(Hls.Events.BUFFER_CODECS, function (_evt, data) {
        try {
          if (!data) return;
          // Sem vídeo no stream
          if (!data.video) {
            console.warn('[mefly] stream sem vídeo (audio-only) — solicitando swap');
            onErrorCb('Este canal está sem vídeo no momento.');
            if (!deadCalled) { deadCalled = true; onDeadCb(); }
            try { hls.destroy(); hls = null; } catch (_) {}
            return;
          }
          var codec = data.video.codec || '';
          var container = data.video.container || 'video/mp4';
          var mime = container + '; codecs="' + codec + '"';
          var supported = false;
          try { supported = !!(v.canPlayType && v.canPlayType(mime)); } catch (_) {}
          console.log('[mefly] codec detectado:', codec, '| pode tocar:', supported ? 'sim' : 'NÃO');
          if (!supported) {
            onErrorCb('Vídeo deste canal usa um codec que a TV não decodifica.');
            if (!deadCalled) { deadCalled = true; onDeadCb(); }
            try { hls.destroy(); hls = null; } catch (_) {}
          }
        } catch (_) {}
      });

      // SMART RETRY: a maioria dos erros em IPTV é blip de rede (.ts que falhou
      // baixar, manifest 502 temporário). Não falamos NADA pro usuário; só
      // tentamos retomar o stream silenciosamente. Só declaramos fatal depois
      // de algumas tentativas no mesmo tipo de erro.
      hls.on(Hls.Events.ERROR, function (_evt, data) {
        if (!data || !data.fatal) {
          // Erro não-fatal: hls.js já tenta sozinho, a gente nem fala.
          return;
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          netErrors++;
          if (netErrors <= MAX_NET) {
            // tentativa de recuperação silenciosa
            try { hls.startLoad(); } catch (_) {}
            // Mostra o spinner pra dar feedback de "voltando"
            onLoadingCb();
            return;
          }
          onErrorCb('Sem conexão com o canal.');
          if (!deadCalled) { deadCalled = true; onDeadCb(); }
          try { hls.destroy(); hls = null; } catch (_) {}
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          mediaErrors++;
          if (mediaErrors <= MAX_MEDIA) {
            try { hls.recoverMediaError(); } catch (_) {}
            return;
          }
          onErrorCb('Não foi possível tocar este canal.');
          if (!deadCalled) { deadCalled = true; onDeadCb(); }
          try { hls.destroy(); hls = null; } catch (_) {}
        } else {
          onErrorCb('Não foi possível tocar este canal.');
          if (!deadCalled) { deadCalled = true; onDeadCb(); }
          try { hls.destroy(); hls = null; } catch (_) {}
        }
      });

      // Se o ABR mudar pra uma variante com erro de decodificação, força recover.
      v.addEventListener('error', function () {
        try { hls && hls.recoverMediaError && hls.recoverMediaError(); } catch (_) {}
      }, { once: true });
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

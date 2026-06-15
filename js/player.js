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

  // MODO DE REPRODUÇÃO — escolha do usuário entre:
  //   'live'   → colado no AO VIVO (sem atraso). Bom pra jogo/notícia. Cushion
  //              pequeno: numa queda, pula pra borda do vivo e reconecta.
  //   'stable' → senta uns segundos ATRÁS do vivo, com buffer na frente. Engole
  //              quedas sem travar (tem "espaço pra respirar"), mas com atraso.
  // Guardado em localStorage pra valer entre sessões. Padrão: 'live'.
  var MODE_KEY = 'mefly_tv_playback_mode';
  var playbackMode = 'live';
  try { var sm = localStorage.getItem(MODE_KEY); if (sm === 'live' || sm === 'stable') playbackMode = sm; } catch (_) {}
  function isStable() { return playbackMode === 'stable'; }
  var onErrorCb = null;
  var onPlayingCb = null;
  var onLoadingCb = null;
  var onDeadCb = null;
  // Vigia anti-congelamento: monitora se o vídeo está REALMENTE avançando.
  var watchdog = null;
  var lastTime = 0;
  var frozenTicks = 0;
  var recovering = 0;     // nº de tentativas de recuperação no canal atual
  var usingHls = false;   // o canal atual está tocando via hls.js?
  var hardTimer = null;   // agendamento de recarga dura (com espaçamento)
  var lastHardAt = 0;     // quando foi a última recarga dura (pra não martelar)
  // Contadores de erro: deixamos o canal tomar uma trombadinha de rede ou um
  // erro de mídia ANTES de escalar. A grande maioria dos "erros" em IPTV é só
  // um fragmento .ts que falhou — a hls.js só precisa retomar.
  var netErrors = 0;
  var mediaErrors = 0;
  var MAX_NET = 4;      // falhas de rede seguidas antes de recarregar duro
  var MAX_MEDIA = 2;    // erros de mídia antes de recarregar duro
  var MAX_RECOVER = 12; // teto de tentativas antes de desistir (e deixar trocar)

  function destroy() {
    clearTimeout(stallTimer);
    stallTimer = null;
    clearTimeout(hardTimer);
    hardTimer = null;
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
    usingHls = false;
    lastHardAt = 0;
  }

  function stopWatchdog() { if (watchdog) { clearInterval(watchdog); watchdog = null; } }

  function startPlay() {
    if (!currentVideo) return;
    var p = currentVideo.play();
    if (p && typeof p.then === 'function') {
      p.catch(function () {
        // Alguns players rejeitam a Promise se a TV pedir interação; o evento
        // 'playing' ainda dispara depois quando de fato funciona.
      });
    }
  }

  // Liga o vigia: a cada 3s confere se o currentTime avançou. Se ficar parado,
  // tenta religar o stream. O limiar CRESCE conforme as tentativas (backoff),
  // pra não martelar a TV/rede quando a internet está mesmo ruim.
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
      var thresh = 3 + Math.min(recovering, 5); // ~9s no começo, até ~24s
      if (frozenTicks >= thresh) {
        frozenTicks = 0;
        recover(false);
      }
    }, 3000);
  }

  // Pula pra borda do AO VIVO. Numa transmissão ao vivo, depois de uma quedinha
  // o player fica "preso" num ponto cujos segmentos JÁ EXPIRARAM do servidor —
  // aí ele nunca volta sozinho. A cura é saltar pro ao vivo e seguir dali.
  function seekToLive() {
    if (!currentVideo) return;
    try {
      var target = null;
      if (hls && typeof hls.liveSyncPosition === 'number' && isFinite(hls.liveSyncPosition)) {
        target = hls.liveSyncPosition; // hls.js só define isso em transmissão AO VIVO
      } else if (currentVideo.duration === Infinity) {
        // nativo + ao vivo (duration infinita): pula pro fim da janela ao vivo.
        // Num VOD (duração finita) NÃO mexe — senão pularia pro fim do vídeo.
        var sk = currentVideo.seekable;
        if (sk && sk.length) {
          var end = sk.end(sk.length - 1);
          if (isFinite(end)) target = Math.max(0, end - 1);
        }
      }
      if (target !== null && target - (currentVideo.currentTime || 0) > 1.5) {
        currentVideo.currentTime = target;
      }
    } catch (_) {}
  }

  // Entrada ÚNICA de recuperação. forceHard pula direto pra recarga dura.
  //   1ª-2ª tentativa: LEVE  — retoma o load (no modo 'live' pula pro ao vivo).
  //   3ª+ tentativa:   DURA  — recria o player do zero (refaz a playlist).
  // No modo 'stable' NÃO pulamos pro vivo: a ideia é retomar de onde parou,
  // aproveitando o buffer/cushion — atraso é aceitável, travar não.
  // Enquanto recupera, mostramos só o "sintonizando" — pro usuário é uma
  // travadinha, não uma morte. Só desistimos (e deixamos trocar) lá no teto.
  function recover(forceHard) {
    if (!currentVideo || !currentUrl) return;
    recovering++;
    if (recovering > MAX_RECOVER) {
      onErrorCb('Sinal perdido. Tentando outra fonte…');
      if (!deadCalled) { deadCalled = true; onDeadCb(); }
      stopWatchdog();
      return;
    }
    onLoadingCb();
    if (!forceHard && recovering <= 2 && usingHls && hls) {
      try { hls.startLoad(); if (!isStable()) seekToLive(); startPlay(); }
      catch (_) { hardReload(); }
    } else {
      hardReload();
    }
  }

  // Recarga dura: recria o player do zero pro MESMO canal. Espaça pelo menos 4s
  // entre recargas pra não entrar em loop apertado quando o erro volta na hora.
  function hardReload() {
    var since = Date.now() - lastHardAt;
    if (since < 4000) {
      if (!hardTimer) {
        hardTimer = setTimeout(function () { hardTimer = null; doHardReload(); }, 4000 - since);
      }
      return;
    }
    doHardReload();
  }
  function doHardReload() {
    if (!currentVideo || !currentUrl) return;
    lastHardAt = Date.now();
    if (hls) { try { hls.destroy(); } catch (_) {} hls = null; }
    if (usingHls) {
      buildHls(); // hls.js novo → refaz a playlist → começa no ao vivo
    } else {
      // nativo (LG/Safari): recarrega o src; no modo 'live' reentra no vivo
      try {
        currentVideo.load();
        startPlay();
        if (!isStable()) setTimeout(seekToLive, 1200);
      } catch (_) {}
    }
  }

  function callOnce(fn) {
    var done = false;
    return function () {
      if (done) return;
      done = true;
      try { fn.apply(null, arguments); } catch (_) {}
    };
  }

  // Cria (ou recria) a instância hls.js pro canal atual. Separado em função
  // própria porque a recarga dura (doHardReload) também precisa montar tudo
  // do zero. Uma hls.js recém-criada já entra perto do AO VIVO sozinha — é o
  // que conserta o canal que "ficou pra trás" e parou.
  function buildHls() {
    var v = currentVideo, url = currentUrl;
    if (!v || !url) return;
    var stable = isStable();
    hls = new Hls({
      enableWorker: false,
      lowLatencyMode: false,
      autoStartLoad: true,
      startLevel: -1,
      // --- buffer / latência conforme o MODO ---
      // 'stable': senta mais atrás do vivo e segura mais buffer → cushion grande,
      //           engole quedas (com atraso). 'live': colado no vivo, cushion menor.
      backBufferLength: stable ? 60 : 30,
      maxBufferLength: stable ? 60 : 30,
      maxMaxBufferLength: stable ? 120 : 60,
      liveSyncDurationCount: stable ? 6 : 3,          // qtos segmentos atrás do vivo
      liveMaxLatencyDurationCount: stable ? 60 : 10,  // 'stable' NÃO força voltar pro vivo
      // --- resiliência comum a IPTV ao vivo ---
      maxBufferHole: 0.5,               // pula buraquinhos no buffer em vez de travar
      nudgeMaxRetry: 8,                 // mais "empurrõezinhos" antes de declarar erro
      manifestLoadingTimeOut: 20000,
      manifestLoadingMaxRetry: 4,
      levelLoadingTimeOut: 20000,
      levelLoadingMaxRetry: 4,
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
    // baixar, manifest 502 temporário). Não falamos NADA pro usuário; tentamos
    // retomar pulando pro AO VIVO. Se insistir, escalamos pra recarga dura —
    // NUNCA declaramos o canal morto por rede (só lá no teto de tentativas, e
    // mesmo assim pra deixar a troca automática agir).
    hls.on(Hls.Events.ERROR, function (_evt, data) {
      if (!data || !data.fatal) return; // não-fatal: a hls.js já se vira
      onLoadingCb();
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        netErrors++;
        if (netErrors <= MAX_NET) {
          try { hls.startLoad(); if (!isStable()) seekToLive(); } catch (_) {}
          return;
        }
        netErrors = 0;
        setTimeout(function () { recover(true); }, 0); // recarga dura (fora do callback)
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        mediaErrors++;
        if (mediaErrors <= MAX_MEDIA) {
          try { hls.recoverMediaError(); } catch (_) {}
          return;
        }
        mediaErrors = 0;
        setTimeout(function () { recover(true); }, 0);
      } else {
        setTimeout(function () { recover(true); }, 0);
      }
    });

    // Se o ABR mudar pra uma variante com erro de decodificação, força recover.
    v.addEventListener('error', function () {
      try { hls && hls.recoverMediaError && hls.recoverMediaError(); } catch (_) {}
    }, { once: true });
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
      usingHls = false;
      v.src = url;
      startPlay();
      return;
    }

    // 2) hls.js — caminho universal (Chrome, WebView do Android e afins).
    //    Cobre .m3u8 e, fora das plataformas nativas, também HLS sem extensão
    //    (.m3u8 atrás de proxy/token), que antes morria caindo no v.src direto.
    if (hlsJsOk && (isHlsUrl || (!trustyNative && !isDirectFile))) {
      usingHls = true;
      buildHls();
      return;
    }

    // 3) Último recurso: tentar direto (MP4, WebM, etc.)
    usingHls = false;
    v.src = url;
    startPlay();
  }

  // Define o modo de reprodução ('live' | 'stable'), salva e — se um canal já
  // estiver tocando — aplica na hora recriando o player (recarga dura), que
  // reentra no buffer/latência do novo modo. Devolve o modo efetivo.
  function setMode(mode) {
    if (mode !== 'live' && mode !== 'stable') return playbackMode;
    playbackMode = mode;
    try { localStorage.setItem(MODE_KEY, mode); } catch (_) {}
    if (currentVideo && currentUrl) {
      recovering = 0; netErrors = 0; mediaErrors = 0; lastHardAt = 0;
      doHardReload();
    }
    return playbackMode;
  }
  function getMode() { return playbackMode; }

  global.MeflyPlayer = {
    play: play,
    stop: destroy,
    setMode: setMode,
    getMode: getMode
  };
})(window);

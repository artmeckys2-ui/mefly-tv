/**
 * ui-channels.js — Tela de "Canais" + Categorias + Favoritos + Player.
 * Layout novo: duas colunas (1ª Fila / 2ª Fila), chips coloridos, cards-pílula.
 */
(function (global) {
  'use strict';

  // ===== ESTADO =====
  var allChannels = [];
  var visibleChannels = [];
  var currentGroup = 'Todos';
  var searchTerm = '';
  var searchTimer = null;
  var dead = {};
  var placeholderLogos = {};

  // ===== ELEMENTOS =====
  var groupsEl, gridEl, emptyEl, statusEl, searchInputEl;
  var favGridEl, favEmptyEl, favStatusEl;
  var liveGridEl, liveEmptyEl, liveSubEl;

  // ===== CATEGORIAS =====
  var CATS_ORDER = ['Principais', 'Esportes', 'Filmes', 'Notícias', 'Infantil', 'Variedades', 'Música'];
  var CAT_LABEL = {
    'Todos':      'Todas',
    'Principais': 'Populares',
    'Esportes':   'Esportes',
    'Filmes':     'Filmes',
    'Notícias':   'Notícias',
    'Infantil':   'Infantil',
    'Variedades': 'Variedades',
    'Música':     'Música'
  };
  var CAT_ICON = {
    'Todos':      '✦',
    'Principais': '🔥',
    'Esportes':   '⚽',
    'Filmes':     '🎬',
    'Notícias':   '📰',
    'Infantil':   '🧸',
    'Variedades': '🎭',
    'Música':     '🎵'
  };
  var CAT_PATTERNS = [
    ['Esportes',   /\b(sport|esport|futebol|gol\b|champion|premier|nba|nfl|ufc|combate|f1|fórmula|formula|tnt sports|espn|cazé|premiere)\b/i],
    ['Filmes',     /\b(movie|filme|cinema|hbo|telecine|megapix|warner|paramount|sony|universal|fox|cinemax|amc|a&e|axn)\b/i],
    ['Notícias',   /\b(news|not[ií]cia|globo ?news|cnn|band ?news|record ?news|jovem pan|globo rural|jornal)\b/i],
    ['Infantil',   /\b(kids|infantil|child|gloob|cartoon|nick|disney|baby|discovery kids|tooncast|boomerang|tiny pop)\b/i],
    ['Música',     /\b(m[uú]sica|music|mtv|multishow|bis|hits|vh1|sertanejo)\b/i]
  ];
  function classifyChannel(c) {
    var hay = (String(c.group || '') + ' ' + String(c.name || '')).toLowerCase();
    for (var i = 0; i < CAT_PATTERNS.length; i++) {
      if (CAT_PATTERNS[i][1].test(hay)) return CAT_PATTERNS[i][0];
    }
    return 'Variedades';
  }
  var MAIN_RE = /\b(globo|gnt|globonews|sbt|record(\s|news|tv)|band(\s|news|sports|eirantes)?|rede ?tv|cultura|cnn brasil|jovem pan|tv brasil|sportv|premiere|espn|cazé|tnt|telecine|warner|discovery|hbo|megapix|multishow|gloob|cartoon|disney|nickelodeon|viva|canal brasil)\b/i;
  function isMainChannel(c) { return MAIN_RE.test(String(c.name || '')); }

  // ===== PLAYER STATE =====
  var playerEl, videoEl, osdEl, osdNumberEl, osdNameEl, osdLogoEl, osdGroupEl, osdClockEl, osdFavEl;
  var loadingOverlay, errorOverlay, errorTitleEl, errorTextEl, loadingTextEl, loadingLogoEl;
  var playerListEl, playerListBodyEl, playerHintEl, loadingLogoWrap, loadingLogoMono;
  var currentChannel = null;
  var lastChannel = null; // canal anterior pro AZUL (zap-back / "flip" clássico)
  var playerListVisible = false;
  var osdTimer = null, hintTimer = null;
  var numEntry = '', numEntryTimer = null, numEntryEl = null, numDigitsEl = null;

  function init() {
    groupsEl = document.getElementById('groups');
    gridEl = document.getElementById('channels-grid');
    emptyEl = document.getElementById('channels-empty');
    statusEl = document.getElementById('channels-status');
    searchInputEl = document.getElementById('search-input');
    favGridEl = document.getElementById('favorites-grid');
    favEmptyEl = document.getElementById('favorites-empty');
    favStatusEl = document.getElementById('favorites-status');
    liveGridEl = document.getElementById('live-grid');
    liveEmptyEl = document.getElementById('live-empty');
    liveSubEl = document.getElementById('live-sub');
    var lhl = document.getElementById('lhl-restore');
    if (lhl) lhl.onclick = function () {
      try { global.MeflyStorage.clearDead(); } catch (_) {}
      dead = {};
      // limpa cache de falhas pra tentar de novo
      for (var id in frameCache) {
        if (frameCache[id] === 'fail' || frameCache[id] === 'timeout' || frameCache[id] === 'error') {
          delete frameCache[id];
        }
      }
      renderLive();
      renderGroups();
      applyFilter();
      var el = document.getElementById('toast');
      if (el) {
        el.className = 'toast success';
        el.textContent = '✓ Canais ocultos restaurados';
        el.classList.remove('hidden');
        setTimeout(function () { el.classList.add('hidden'); }, 2200);
      }
    };

    if (searchInputEl) {
      searchInputEl.addEventListener('input', function () {
        searchTerm = searchInputEl.value || '';
        clearTimeout(searchTimer);
        searchTimer = setTimeout(applyFilter, 350);
      });
    }

    playerEl = document.getElementById('player');
    videoEl = document.getElementById('video');
    osdEl = document.getElementById('osd');
    osdNumberEl = document.getElementById('osd-number');
    osdNameEl = document.getElementById('osd-name');
    osdLogoEl = document.getElementById('osd-logo');
    osdGroupEl = document.getElementById('osd-group');
    osdClockEl = document.getElementById('osd-clock');
    osdFavEl = document.getElementById('osd-fav');
    loadingOverlay = document.getElementById('player-loading');
    errorOverlay = document.getElementById('player-error');
    errorTitleEl = document.getElementById('player-error-title');
    errorTextEl = document.getElementById('player-error-text');
    loadingTextEl = document.getElementById('player-loading-text');
    loadingLogoEl = document.getElementById('player-logo');
    loadingLogoWrap = document.getElementById('player-logo-wrap');
    loadingLogoMono = document.getElementById('player-logo-mono');
    playerListEl = document.getElementById('player-list');
    playerListBodyEl = document.getElementById('player-list-body');
    playerHintEl = document.getElementById('player-hint');
    numEntryEl = document.getElementById('ch-num-entry');
    numDigitsEl = document.getElementById('cne-digits');
  }

  function load(onDone) {
    statusEl.textContent = 'Carregando canais…';
    if (gridEl) gridEl.innerHTML = '';
    emptyEl.classList.add('hidden');

    var addons = global.MeflyStorage.loadAddons();
    dead = global.MeflyStorage.loadDead();

    global.MeflyChannels.loadAll(addons).then(function (result) {
      allChannels = result.channels || [];
      detectPlaceholderLogos();

      if (result.recovered && result.recovered.length) {
        showRecoveryToast(result.recovered);
      }
      try {
        var saved = localStorage.getItem('mefly_tv_last_group');
        if (saved && (saved === 'Todos' || saved === 'Principais' ||
            allChannels.some(function (c) { return String(c.group || '').trim() === saved; }))) {
          currentGroup = saved;
        }
      } catch (_) {}
      buildTwinIndex();
      renderGroups();
      renderLive();
      applyFilter();

      var totalLive = allChannels.filter(function (c) { return !dead[c.id]; }).length;
      if (totalLive === 0) {
        statusEl.textContent = 'Nenhum canal disponível';
        emptyEl.classList.remove('hidden');
      } else {
        statusEl.textContent = totalLive + ' canais ao vivo';
      }
      setTimeout(function () { global.MeflyNav.focusFirst(); }, 100);
      if (typeof onDone === 'function') onDone();
    }).catch(function (e) {
      statusEl.textContent = 'Erro ao carregar canais';
      emptyEl.classList.remove('hidden');
      console.error('[channels load]', e);
      if (typeof onDone === 'function') onDone();
    });
  }

  function detectPlaceholderLogos() {
    placeholderLogos = {};
    var count = {};
    for (var i = 0; i < allChannels.length; i++) {
      var lg = allChannels[i].logo;
      if (lg) count[lg] = (count[lg] || 0) + 1;
    }
    for (var url in count) {
      if (count[url] >= 15) placeholderLogos[url] = true;
    }
  }

  // CARREGAMENTO DE LOGOS COM THROTTLE — o maior vilão do lag na TV.
  // O código antigo disparava 1000+ downloads + decodes de imagem PRATICAMENTE
  // AO MESMO TEMPO ao montar a lista, afogando CPU/rede/memória da TV (que é
  // bem mais fraca que um PC). Agora os logos entram numa fila e carregam só
  // alguns por vez, na ordem dos cards (os de cima — visíveis — primeiro).
  // A TV nunca mais leva o "soco" de mil imagens de uma vez.
  //
  // Por que fila e não IntersectionObserver? Porque em alguns estados do WebView
  // (transição de splash, app em segundo plano) a página é marcada como "hidden"
  // e o IO NUNCA dispara — os logos ficariam em branco. A fila não depende de
  // visibilidade: sempre carrega, só que de forma escalonada.
  var logoQueue = [];
  var logoActive = 0;
  var LOGO_CONCURRENCY = 6;   // quantos logos baixam ao mesmo tempo
  var logoToken = 0;          // invalida a fila quando o grid re-renderiza

  function attachLogo(avatarEl, src) {
    if (!src) return;
    if (placeholderLogos[src]) return;
    logoQueue.push({ el: avatarEl, src: src, token: logoToken });
    pumpLogoQueue();
  }
  function pumpLogoQueue() {
    while (logoActive < LOGO_CONCURRENCY && logoQueue.length) {
      var job = logoQueue.shift();
      if (job.token !== logoToken) continue; // job de um grid já descartado
      logoActive++;
      loadLogoNow(job.el, job.src, function () {
        logoActive--;
        pumpLogoQueue();
      });
    }
  }
  // Zera a fila pendente (chamado quando o grid re-renderiza por busca/categoria).
  // Os downloads já em voo terminam sozinhos; só não puxamos mais os antigos.
  function resetLogoQueue() {
    logoToken++;
    logoQueue.length = 0;
  }
  function loadLogoNow(avatarEl, src, onDone) {
    onDone = onDone || function () {};
    if (!src) { onDone(); return; }
    var pre = new Image();
    var settled = false;
    function fin() { if (settled) return; settled = true; onDone(); }
    pre.onload = function () {
      if (pre.naturalWidth >= 8 && pre.naturalHeight >= 8) {
        var mono = avatarEl.querySelector('.mono-letter');
        if (mono) mono.parentNode.removeChild(mono);
        avatarEl.classList.add('has-logo');
        avatarEl.removeAttribute('data-tone');
        var img = document.createElement('img');
        img.alt = ''; img.decoding = 'async'; img.src = src;
        img.style.opacity = '0'; img.style.transition = 'opacity 0.25s ease';
        avatarEl.appendChild(img);
        requestAnimationFrame(function () { img.style.opacity = '1'; });
      }
      fin();
    };
    pre.onerror = fin;
    pre.src = src;
  }

  // ===== CHIPS =====
  function renderGroups() {
    var live = allChannels.filter(function (c) { return !dead[c.id]; });
    var counts = { 'Todos': live.length, 'Principais': 0, 'Esportes': 0, 'Filmes': 0,
                   'Notícias': 0, 'Infantil': 0, 'Variedades': 0, 'Música': 0 };
    for (var i = 0; i < live.length; i++) {
      var c = live[i];
      if (isMainChannel(c)) counts['Principais']++;
      var cat = classifyChannel(c);
      if (counts[cat] !== undefined) counts[cat]++;
    }

    groupsEl.innerHTML = '';
    var list = ['Todos'];
    for (var k = 0; k < CATS_ORDER.length; k++) {
      if (counts[CATS_ORDER[k]] > 0) list.push(CATS_ORDER[k]);
    }
    for (var j = 0; j < list.length; j++) {
      groupsEl.appendChild(makeCatChip(list[j], counts[list[j]]));
    }
  }

  function makeCatChip(name, n) {
    var btn = document.createElement('button');
    btn.className = 'cat-chip focusable' + (name === currentGroup ? ' selected' : '');
    btn.setAttribute('data-cat', name);
    var ic = document.createElement('span'); ic.className = 'cc-ic'; ic.textContent = CAT_ICON[name] || '✦';
    var nm = document.createElement('span'); nm.className = 'cc-name'; nm.textContent = CAT_LABEL[name] || name;
    var ct = document.createElement('span'); ct.className = 'cc-count'; ct.textContent = n;
    btn.appendChild(ic); btn.appendChild(nm); btn.appendChild(ct);
    btn.onclick = function () { selectCategory(name); };
    return btn;
  }

  function selectCategory(name) {
    currentGroup = name;
    try { localStorage.setItem('mefly_tv_last_group', name); } catch (_) {}
    if (searchInputEl && searchInputEl.value) { searchInputEl.value = ''; searchTerm = ''; }
    var chips = groupsEl.querySelectorAll('.cat-chip');
    for (var k = 0; k < chips.length; k++) {
      chips[k].classList.toggle('selected', chips[k].getAttribute('data-cat') === name);
    }
    applyFilter();
  }

  // ===== AO VIVO — destaques do que está rolando agora =====
  // Heurística honesta: como não dá pra capturar frame real dos streams sem
  // tocar cada um (custaria muito), montamos os destaques com base em:
  // - dia da semana / horário (jogos à noite, manhã de notícias, etc.)
  // - categoria do canal (esportes, notícias, principais e variedades)
  // - canais "Principais" sempre entram, mais um sortimento das categorias quentes
  var LIVE_TONES = [
    ['#8b6cf2','#d36cf0'], ['#ff6b6b','#ff9a8b'], ['#2ea96c','#8ed1a5'],
    ['#2b80e0','#5cb6f2'], ['#e94481','#f6a3c1'], ['#ffb347','#ff8c42'],
    ['#1ea0b6','#6ddae6'], ['#d09a18','#f2c84b']
  ];
  function liveScore(c) {
    var name = String(c.name || '').toLowerCase();
    var cat = classifyChannel(c);
    var d = new Date();
    var h = d.getHours();
    var dow = d.getDay(); // 0=domingo
    var score = 0;
    if (isMainChannel(c)) score += 60;
    if (cat === 'Notícias') score += (h >= 6 && h <= 10) || (h >= 18 && h <= 22) ? 50 : 25;
    if (cat === 'Esportes') {
      score += 40;
      // jogos: fim de tarde, noite, fim de semana
      if (h >= 16 && h <= 23) score += 25;
      if (dow === 0 || dow === 3 || dow === 6) score += 15;
    }
    if (cat === 'Filmes') score += (h >= 19 || h <= 1) ? 35 : 15;
    if (cat === 'Variedades') score += 20;
    if (cat === 'Infantil') score += (h >= 7 && h <= 12) ? 30 : 10;
    if (cat === 'Música') score += 18;
    // bônus pra canais com logo (ficam bonitos no tile)
    if (c.logo) score += 8;
    // tom estável: mesma posição em rerender no mesmo minuto
    score += (toneFor(name) % 5);
    return score;
  }
  function renderLive() {
    if (!liveGridEl) return;
    // Atualiza o cache de dead antes de filtrar (caso tenha vencido o TTL de 5h)
    dead = global.MeflyStorage.loadDead();
    var live = allChannels.filter(function (c) { return !dead[c.id]; });
    if (!live.length) {
      liveGridEl.innerHTML = '';
      liveEmptyEl.classList.remove('hidden');
      if (liveSubEl) liveSubEl.textContent = '';
      updateHiddenLink();
      return;
    }
    var ranked = live.slice().sort(function (a, b) { return liveScore(b) - liveScore(a); });
    var pick = ranked.slice(0, 16);
    liveEmptyEl.classList.add('hidden');
    if (liveSubEl) liveSubEl.textContent = pick.length + ' destaques · ' + nowHHMM();

    liveGridEl.innerHTML = '';
    liveBgQueue = []; // zera a fila anterior
    var frag = document.createDocumentFragment();
    var tilesByChannel = [];
    for (var i = 0; i < pick.length; i++) {
      var tile = makeLiveTile(pick[i]);
      frag.appendChild(tile);
      tilesByChannel.push({ ch: pick[i], el: tile });
    }
    liveGridEl.appendChild(frag);

    // Enfileira CAPTURA AUTOMÁTICA em background — 1 canal por vez.
    for (var j = 0; j < tilesByChannel.length; j++) {
      enqueueBgCapture(tilesByChannel[j].ch, tilesByChannel[j].el);
    }
    // Dá um respiro antes de começar pra primeira renderização aparecer
    setTimeout(processBgQueue, 400);

    updateHiddenLink();
  }

  // ===== "Ver canais ocultos" — link discreto =====
  // Mostra a contagem de canais escondidos por 5h e permite restaurar todos.
  function updateHiddenLink() {
    var holder = document.getElementById('live-hidden-link');
    if (!holder) return;
    var deadNow = global.MeflyStorage.loadDead();
    var n = Object.keys(deadNow).length;
    if (n === 0) { holder.classList.add('hidden'); return; }
    holder.classList.remove('hidden');
    holder.querySelector('.lhl-count').textContent = n;
  }
  // ===== Captura de FRAME do canal pra usar como thumb dos tiles "Ao Vivo".
  // Estratégia: quando o usuário foca um tile, tocamos o stream em um <video>
  // invisível por 2-3s, esperamos um keyframe, desenhamos no canvas e usamos
  // como background do tile. Se o stream taint (CORS de .ts), caímos no design
  // bonito original (logo grande + gradiente).
  var frameCache = {};         // id -> dataURL | 'fail' | 'audio-only'
  var frameInflightIds = {};   // ids sendo capturados agora (paralelo)
  var liveBgQueue = [];        // fila de captura em background pra tela Ao Vivo
  var BG_PARALLEL = 3;         // quantas capturas simultâneas (TV: 3 é seguro)
  // Cada captura cria seu próprio <video>+Hls — assim podemos rodar várias em
  // paralelo sem que uma derrube a outra. Quando termina, o elemento é descartado.
  function makeFrameVideo() {
    var v = document.createElement('video');
    v.muted = true; v.playsInline = true;
    v.crossOrigin = 'anonymous';
    v.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:320px;height:180px;';
    document.body.appendChild(v);
    return v;
  }
  function disposeFrameVideo(v, h) {
    try { if (h) h.destroy(); } catch (_) {}
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch (_) {}
    try { if (v.parentNode) v.parentNode.removeChild(v); } catch (_) {}
  }
  function inflightCount() {
    var n = 0; for (var k in frameInflightIds) if (frameInflightIds[k]) n++; return n;
  }
  function captureFrame(ch, tileEl, onDoneCb) {
    onDoneCb = onDoneCb || function () {};
    if (!ch) return onDoneCb(false);
    var cached = frameCache[ch.id];
    if (cached === 'fail' || cached === 'audio-only' || cached === 'cors' || cached === 'timeout' || cached === 'error') return onDoneCb(false);
    if (cached) { if (tileEl) applyFrame(tileEl, cached); return onDoneCb(true); }
    if (frameInflightIds[ch.id]) return onDoneCb(false); // já capturando esse
    frameInflightIds[ch.id] = true;

    global.MeflyAddons.resolveStream(ch).then(function (url) {
      var v = makeFrameVideo();
      var h = null;
      var done = false;

      function finish(ok, dataUrl, reason) {
        if (done) return; done = true;
        clearTimeout(t);
        disposeFrameVideo(v, h);
        delete frameInflightIds[ch.id];
        if (ok && dataUrl) {
          frameCache[ch.id] = dataUrl;
          if (tileEl) applyFrame(tileEl, dataUrl);
        } else {
          frameCache[ch.id] = reason || 'fail';
          // Falha "dura" → snooza por 5h. Falha "leve" (CORS, audio-only) não.
          if (reason === 'fail' || reason === 'timeout' || reason === 'error') {
            try { global.MeflyStorage.markDead(ch.id); dead[ch.id] = true; } catch (_) {}
          }
        }
        onDoneCb(ok);
      }

      var t = setTimeout(function () { finish(false, null, 'timeout'); }, 5000);

      v.onloadeddata = function () {
        setTimeout(function () {
          try {
            if (!v.videoWidth || !v.videoHeight) {
              finish(false, null, 'audio-only');
              return;
            }
            var c = document.createElement('canvas');
            c.width = 320; c.height = 180;
            c.getContext('2d').drawImage(v, 0, 0, 320, 180);
            var data = c.toDataURL('image/jpeg', 0.72);
            finish(true, data);
          } catch (e) {
            finish(false, null, 'cors');
          }
        }, 500);
      };
      v.onerror = function () { finish(false, null, 'error'); };

      if (/\.m3u8(\?|$)/i.test(url) && window.Hls && window.Hls.isSupported()) {
        try {
          h = new window.Hls({ enableWorker: false, manifestLoadingTimeOut: 4000, fragLoadingTimeOut: 5000 });
          h.loadSource(url);
          h.attachMedia(v);
          h.on(window.Hls.Events.ERROR, function (_e, data) {
            if (data && data.fatal) finish(false, null, 'error');
          });
        } catch (e) { finish(false, null, 'error'); }
      } else {
        v.src = url;
      }
      v.play().catch(function () {});
    }).catch(function () {
      delete frameInflightIds[ch.id];
      frameCache[ch.id] = 'fail';
      try { global.MeflyStorage.markDead(ch.id); dead[ch.id] = true; } catch (_) {}
      onDoneCb(false);
    });
  }

  // Fila de captura em background. Roda BG_PARALLEL=3 streams ao mesmo tempo
  // — assim 16 thumbs carregam em ~15s em vez de ~60s.
  function processBgQueue() {
    var screenLive = document.getElementById('screen-live');
    if (!screenLive || !screenLive.classList.contains('active')) {
      liveBgQueue = [];
      return;
    }
    while (inflightCount() < BG_PARALLEL && liveBgQueue.length) {
      var job = liveBgQueue.shift();
      // Cada captura, ao terminar, chama processBgQueue de novo pra puxar a próxima.
      (function (j) {
        captureFrame(j.ch, j.tileEl, function () {
          setTimeout(processBgQueue, 80);
        });
      })(job);
    }
  }
  function enqueueBgCapture(ch, tileEl) {
    if (frameCache[ch.id]) return;
    liveBgQueue.push({ ch: ch, tileEl: tileEl });
  }
  function applyFrame(tileEl, dataUrl) {
    var thumb = tileEl.querySelector('.lt-thumb');
    if (!thumb) return;
    thumb.classList.remove('no-logo');
    thumb.classList.add('has-frame');
    thumb.innerHTML = '';
    thumb.style.backgroundImage = 'url(' + dataUrl + ')';
  }

  function makeLiveTile(ch) {
    var name = displayName(ch.name);
    var cat = classifyChannel(ch);
    var tone = LIVE_TONES[toneFor(name) % LIVE_TONES.length];

    var btn = document.createElement('button');
    btn.className = 'live-tile focusable';
    btn.style.setProperty('--tile-c1', tone[0]);
    btn.style.setProperty('--tile-c2', tone[1]);

    var thumb = document.createElement('div');
    thumb.className = 'lt-thumb';
    if (ch.logo && !placeholderLogos[ch.logo]) {
      var img = document.createElement('img');
      img.alt = ''; img.src = ch.logo;
      img.onerror = function () { thumb.classList.add('no-logo'); thumb.innerHTML = ''; };
      thumb.appendChild(img);
    } else {
      thumb.classList.add('no-logo');
    }

    var veil = document.createElement('div'); veil.className = 'lt-veil';

    var tag = document.createElement('div'); tag.className = 'lt-tag'; tag.textContent = 'Ao Vivo';
    var catTag = document.createElement('div'); catTag.className = 'lt-cat';
    catTag.textContent = CAT_LABEL[cat] || cat;

    var body = document.createElement('div'); body.className = 'lt-body';
    var nm = document.createElement('div'); nm.className = 'lt-name'; nm.textContent = name;
    var sub = document.createElement('div'); sub.className = 'lt-sub';
    sub.textContent = 'Acompanhe agora · ' + nowHHMM();
    body.appendChild(nm); body.appendChild(sub);

    btn.appendChild(thumb);
    btn.appendChild(veil);
    btn.appendChild(tag);
    btn.appendChild(catTag);
    btn.appendChild(body);

    btn.onclick = function () { openPlayer(ch); };
    // Captura frame com leve atraso ao focar (deixa o usuário pousar mesmo)
    var focusT = null;
    btn.addEventListener('focus', function () {
      clearTimeout(focusT);
      focusT = setTimeout(function () { captureFrame(ch, btn); }, 350);
    });
    btn.addEventListener('blur', function () { clearTimeout(focusT); });
    return btn;
  }

  // ===== FILTRO + RENDER =====
  function applyFilter() {
    var q = searchTerm.trim().toLowerCase();
    visibleChannels = allChannels.filter(function (c) {
      if (dead[c.id]) return false;
      if (q) return String(c.name || '').toLowerCase().indexOf(q) >= 0;
      if (currentGroup === 'Todos') return true;
      if (currentGroup === 'Principais') return isMainChannel(c);
      return classifyChannel(c) === currentGroup;
    });

    renderGrid(gridEl, visibleChannels);

    if (statusEl) {
      if (q) {
        statusEl.textContent = visibleChannels.length + ' resultado(s) para "' + searchTerm.trim() + '"';
      } else {
        var totalLive = allChannels.filter(function (c) { return !dead[c.id]; }).length;
        statusEl.textContent = totalLive + ' canais ao vivo';
      }
    }
    if (!visibleChannels.length) emptyEl.classList.remove('hidden');
    else emptyEl.classList.add('hidden');
  }

  // Renderiza em LOTES via requestAnimationFrame pra TV não travar com 1000+ cards.
  // Primeiro lote (~viewport) entra direto pro foco funcionar imediatamente.
  // O resto vai sendo anexado sem bloquear o thread.
  var renderToken = 0;
  function renderGrid(el, list) {
    if (!el) return;
    // Descarta a fila de logos do grid anterior (busca/categoria nova) pra não
    // ficar baixando logo de card que nem existe mais.
    resetLogoQueue();
    el.innerHTML = '';
    if (!list.length) return;
    var token = ++renderToken;
    var max = Math.min(list.length, 5000);
    var BATCH_FIRST = 60;   // ~3 colunas x 20 linhas (mais do que cabe em 1080p)
    var BATCH_NEXT = 80;
    // Lote 1 — síncrono
    var frag = document.createDocumentFragment();
    var i = 0;
    var n1 = Math.min(BATCH_FIRST, max);
    for (; i < n1; i++) frag.appendChild(makeChannelCard(list[i]));
    el.appendChild(frag);

    if (i >= max) return;
    // Lotes seguintes — diferidos via setTimeout (mais confiável que rAF em TV,
    // que pode estar com aba "fora de foco" enquanto o usuário lê).
    function tick() {
      if (token !== renderToken) return; // novo filtro chegou, aborta
      var f = document.createDocumentFragment();
      var end = Math.min(i + BATCH_NEXT, max);
      for (; i < end; i++) f.appendChild(makeChannelCard(list[i]));
      el.appendChild(f);
      if (i < max) setTimeout(tick, 30);
    }
    setTimeout(tick, 30);
  }

  function displayName(raw) {
    return String(raw || '')
      .replace(/\(?\s*\d{3,4}\s*p\s*\)?/ig, '')
      .replace(/\b(fhd|uhd|hd|sd|4k)\b/ig, '')
      .replace(/\(\s*\)/g, '')
      .replace(/[\s\-_|.]+$/, '').replace(/^[\s\-_|.]+/, '')
      .replace(/\s{2,}/g, ' ').trim() || raw;
  }
  function qualityBadge(q) {
    if (q >= 2160) return '4K';
    if (q >= 1080) return 'FHD';
    if (q >= 720) return 'HD';
    return '';
  }
  // tom estável por nome (não pulsa entre renders)
  function toneFor(name) {
    var s = String(name || '');
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
    return h % 8;
  }
  function monogram(name) {
    var t = String(name || '').trim();
    if (!t) return '?';
    // Tenta números primeiro (91.5, 98, 103.9 etc.)
    var num = t.match(/^(\d{2,3}(?:\.\d)?)/);
    if (num) return num[1].length > 4 ? num[1].slice(0, 4) : num[1];
    // Senão, 1ª letra das 1-2 primeiras palavras
    var words = t.split(/\s+/);
    if (words.length === 1) return words[0].charAt(0).toUpperCase();
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  }

  function makeChannelCard(ch) {
    var name = displayName(ch.name);
    var cat = classifyChannel(ch);
    var isFav = global.MeflyStorage.isFavorite(ch.id);

    var row = document.createElement('button');
    row.className = 'channel focusable' + (isFav ? ' is-fav' : '');
    row.setAttribute('data-id', ch.id);

    var avatar = document.createElement('div');
    avatar.className = 'ch-avatar';
    avatar.setAttribute('data-tone', toneFor(name));
    var mono = document.createElement('span');
    mono.className = 'mono-letter';
    mono.textContent = monogram(name);
    avatar.appendChild(mono);
    attachLogo(avatar, ch.logo);

    var body = document.createElement('div'); body.className = 'ch-body';
    var nameWrap = document.createElement('div'); nameWrap.className = 'ch-name-wrap';
    var nameEl = document.createElement('span'); nameEl.className = 'ch-name'; nameEl.textContent = name;
    nameWrap.appendChild(nameEl);
    var tag = document.createElement('span'); tag.className = 'ch-tag';
    tag.setAttribute('data-cat', cat);
    tag.textContent = CAT_LABEL[cat] || cat;
    body.appendChild(nameWrap); body.appendChild(tag);

    var heart = document.createElement('div'); heart.className = 'ch-heart';
    heart.innerHTML = isFav
      ? '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';

    row.appendChild(avatar); row.appendChild(body); row.appendChild(heart);

    var badge = qualityBadge(ch.quality || 0);
    if (badge) {
      var b = document.createElement('span');
      b.className = 'ch-quality';
      b.textContent = badge;
      row.appendChild(b);
    }

    // Marquee: ativa só quando o nome não cabe inteiro no card focado.
    row.addEventListener('focus', function () {
      var over = nameEl.scrollWidth - nameWrap.clientWidth;
      if (over > 6) {
        nameEl.style.setProperty('--mq', '-' + (over + 24) + 'px');
        row.classList.add('marquee');
      }
    });
    row.addEventListener('blur', function () {
      row.classList.remove('marquee');
      nameEl.style.removeProperty('--mq');
    });

    row.onclick = function () { openPlayer(ch); };
    return row;
  }

  // ===== TWIN CHANNELS — fallback automático =====
  // Quando o usuário escolhe "Globo SP" e ele não toca, a gente tenta "Globo RJ",
  // "Globo HD", "Globo FHD", "Globo 1", etc. — todos canais equivalentes só com
  // origem/qualidade/região diferentes. Funciona pra qualquer canal redundante.

  // Normaliza o nome do canal num "twin key" — ignora região, qualidade, numerização.
  // Ex.: "Globo SP HD"        -> "globo"
  //      "Globo RJ FHD (2)"   -> "globo"
  //      "SBT BR"             -> "sbt"
  //      "Band Sports BR HD"  -> "band sports"
  // Palavras genéricas que, sozinhas, NÃO formam grupo de twins.
  var GENERIC_TWIN_WORDS = {
    'canal': 1, 'tv': 1, 'rede': 1, 'radio': 1, 'rádio': 1
  };

  // REGRA DE TWIN: dois canais são "iguais" SÓ quando diferem em:
  //   - REGIÃO (Globo SP vs Globo RJ)
  //   - QUALIDADE (Globo SP vs Globo SP HD)
  //   - SUFIXO de variação (Globo SP vs Globo SP Backup)
  // Eles NÃO são iguais quando o nome inclui um número distintivo:
  //   - ESPN ≠ ESPN 2 (canais com transmissões DIFERENTES)
  //   - Premiere FC 1 ≠ Premiere FC 2
  //   - NBA League Pass 1 ≠ NBA League Pass 2
  // Por isso o número é PARTE da chave — se tem número, vira parte do nome
  // canônico e diferencia.
  function twinKey(name) {
    var s = String(name || '').toLowerCase();
    // Parênteses/colchetes (geralmente "(1)", "(backup)", "[FHD]")
    s = s.replace(/[\(\[\{].*?[\)\]\}]/g, ' ');
    // Qualidade
    s = s.replace(/\b(uhd|fhd|hd|sd|4k|2160p?|1080p?|720p?|480p?|360p?)\b/g, ' ');
    // UF brasileiras e marcadores regionais (NÃO inclui "brasil" — nome próprio)
    s = s.replace(/\b(ac|al|am|ap|ba|br|ce|df|bsb|brasilia|es|go|ma|mg|ms|mt|nacional|nac|nord(este)?|nort(e)?|sul|sudeste|centro\s*oeste|pa|pb|pe|pi|pr|rj|rn|ro|rr|rs|sc|se|sp|to)\b/g, ' ');
    // Variações de fonte/CDN (não muda o conteúdo)
    s = s.replace(/\b(alt|backup|mirror|reserva|reserv|teste|test|opt\d*|cdn|edge|origin)\b/g, ' ');
    // Pontuação/separadores
    s = s.replace(/[._\-|+/]+/g, ' ');
    // Compacta espaços
    s = s.replace(/\s+/g, ' ').trim();
    if (!s) return '';
    var words = s.split(' ');
    // Palavra genérica sozinha → ignora
    if (words.length === 1 && GENERIC_TWIN_WORDS[words[0]]) return '';
    return s;
  }

  // Constrói o índice nome → [ids de canais equivalentes].
  // Reconstruído quando allChannels muda.
  var twinIndex = null;
  function buildTwinIndex() {
    twinIndex = {};
    for (var i = 0; i < allChannels.length; i++) {
      var c = allChannels[i];
      var k = twinKey(c.name);
      if (!k || k.length < 2) continue;
      if (!twinIndex[k]) twinIndex[k] = [];
      twinIndex[k].push(c);
    }
  }

  // Devolve os "irmãos" do canal — ele MESMO entra, mas já em última posição;
  // a ordem é: HD/FHD/4K antes; o atual sempre por último.
  function findTwins(ch) {
    if (!twinIndex) buildTwinIndex();
    var k = twinKey(ch.name);
    var list = twinIndex[k] || [];
    if (list.length <= 1) return [];
    // Ordena por qualidade desc, mas o original vai pro fim (já tentamos ele).
    return list.slice().filter(function (c) { return c.id !== ch.id; })
      .sort(function (a, b) { return (b.quality || 0) - (a.quality || 0); });
  }

  // Estado da sessão de "tentativa": canal pedido pelo usuário + lista de twins ainda
  // não testados. Quando dá erro, pega o próximo. Quando o usuário trocar de canal
  // de propósito, isso reseta.
  var swapSession = null; // { requestedId, requestedName, queue: [twins...] }

  // ===== PLAYER =====
  // opts.isSwap=true → não recria a sessão de tentativa, só toca o próximo da fila
  function openPlayer(ch, opts) {
    opts = opts || {};
    var isFirstAttempt = !opts.isSwap;
    var alreadyOpen = !playerEl.classList.contains('hidden');

    if (isFirstAttempt) {
      // Usuário pediu ESTE canal — reinicia o histórico de twins.
      var twins = findTwins(ch).filter(function (t) { return !dead[t.id]; });
      swapSession = { requestedId: ch.id, requestedName: ch.name, queue: twins, attempt: 0 };
      // Guarda o anterior pro "canal flip" (AZUL no LG). Só em troca explícita
      // do usuário — swaps por falha de stream NÃO viram o "anterior".
      if (currentChannel && currentChannel.id !== ch.id) lastChannel = currentChannel;
    }

    currentChannel = ch;
    playerEl.classList.remove('hidden');
    document.body.classList.add('player-open');
    errorOverlay.classList.add('hidden');
    loadingOverlay.classList.remove('hidden');
    showOSD();
    setPlayerLogo(ch);
    if (opts.isSwap) {
      loadingTextEl.textContent = 'Trocando pra ' + ch.name + '…';
    } else {
      loadingTextEl.textContent = 'Sintonizando ' + ch.name + '…';
    }

    if (isFirstAttempt && !alreadyOpen) {
      global.MeflyNav.pushBackHandler(closePlayer);
      global.MeflyNav.addKeyHandler(playerKeyHandler);
    }

    // Helper: quando o canal atual quebra, troca pro próximo twin (se houver).
    function trySwap(reason) {
      if (!swapSession) return false;
      var next = null;
      while (swapSession.queue.length) {
        var cand = swapSession.queue.shift();
        if (cand && !dead[cand.id]) { next = cand; break; }
      }
      if (!next) return false;
      swapSession.attempt++;
      // Toast discreto avisando que tá trocando
      showSwapToast(next, swapSession.requestedName);
      // Toca o próximo SEM resetar a sessão
      setTimeout(function () { openPlayer(next, { isSwap: true }); }, 200);
      return true;
    }

    global.MeflyAddons.resolveStream(ch).then(function (url) {
      // Marca o primeiro loading como "sintonização" (overlay cheio); os próximos
      // (que são reconexões silenciosas) são "reconnect" — quase invisíveis.
      var hasPlayedOnce = false;
      global.MeflyPlayer.play(videoEl, url, {
        onLoading: function () {
          loadingOverlay.classList.remove('hidden');
          errorOverlay.classList.add('hidden');
          if (hasPlayedOnce) {
            loadingOverlay.classList.add('reconnect');
            loadingTextEl.textContent = 'Reconectando…';
          } else {
            loadingOverlay.classList.remove('reconnect');
          }
        },
        onPlaying: function () {
          hasPlayedOnce = true;
          loadingOverlay.classList.add('hidden');
          loadingOverlay.classList.remove('reconnect');
          errorOverlay.classList.add('hidden');
        },
        onError: function (msg) {
          // Antes de mostrar tela de erro, tenta um irmão.
          if (trySwap('error')) return;
          loadingOverlay.classList.add('hidden');
          errorOverlay.classList.remove('hidden');
          errorTitleEl.textContent = ch.name;
          errorTextEl.textContent = msg || 'Canal indisponível.';
        },
        onDead: function () {
          global.MeflyStorage.markDead(ch.id);
          dead[ch.id] = true;
        }
      });
    }).catch(function (e) {
      global.MeflyStorage.markDead(ch.id);
      dead[ch.id] = true;
      if (trySwap('resolve-fail')) return;
      loadingOverlay.classList.add('hidden');
      errorOverlay.classList.remove('hidden');
      errorTitleEl.textContent = ch.name;
      errorTextEl.textContent = 'Este canal está sem transmissão no momento.';
      console.warn('[stream]', e && e.message);
    });
  }

  // Toast discreto pra avisar swap (sem ficar barulhento — só aparece quando
  // a gente realmente troca de canal por causa de falha).
  var swapToastTimer = null;
  function showSwapToast(next, requested) {
    var el = document.getElementById('toast');
    if (!el) return;
    var label = requested && requested !== next.name
      ? '🔁 ' + requested + ' fora do ar — trocando pra ' + next.name
      : '🔁 Trocando pra ' + next.name;
    el.className = 'toast';
    el.innerHTML = label;
    el.classList.remove('hidden');
    clearTimeout(swapToastTimer);
    swapToastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2800);
  }

  function closePlayer() {
    if (playerEl.classList.contains('hidden')) return;
    cancelNumEntry();
    global.MeflyPlayer.stop();
    playerEl.classList.add('hidden');
    document.body.classList.remove('player-open');
    playerListEl.classList.add('hidden');
    playerListVisible = false;
    swapSession = null;
    global.MeflyNav.popBackHandler();
    global.MeflyNav.removeKeyHandler(playerKeyHandler);
    currentChannel = null;
    setTimeout(function () { global.MeflyNav.focusFirst(); }, 50);
  }

  function showOSD() {
    if (!currentChannel) return;
    var idx = visibleChannels.findIndex(function (c) { return c.id === currentChannel.id; });
    var num = idx >= 0 ? String(idx + 1).padStart(3, '0') : '—';
    osdNumberEl.textContent = num;
    osdNameEl.textContent = currentChannel.name;
    setLogo(osdLogoEl, currentChannel.logo);
    osdGroupEl.textContent = CAT_LABEL[classifyChannel(currentChannel)] || (currentChannel.group || '—');
    osdClockEl.textContent = nowHHMM();
    if (osdFavEl) {
      if (global.MeflyStorage.isFavorite(currentChannel.id)) osdFavEl.classList.remove('hidden');
      else osdFavEl.classList.add('hidden');
    }
    osdEl.classList.add('show');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () { osdEl.classList.remove('show'); }, 5000);

    playerHintEl.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { playerHintEl.classList.remove('show'); }, 4000);
  }

  function nowHHMM() {
    var d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // Player loading: monograma se não tem logo; troca pro logo quando carrega.
  function setPlayerLogo(ch) {
    if (!loadingLogoWrap) return;
    var name = displayName(ch.name);
    loadingLogoMono.textContent = monogram(name);
    loadingLogoWrap.classList.add('no-logo');
    loadingLogoWrap.classList.remove('has-logo');
    loadingLogoEl.removeAttribute('src');
    if (!ch.logo || placeholderLogos[ch.logo]) return;
    var pre = new Image();
    pre.onload = function () {
      if (pre.naturalWidth < 8) return;
      loadingLogoEl.src = ch.logo;
      loadingLogoWrap.classList.remove('no-logo');
      loadingLogoWrap.classList.add('has-logo');
    };
    pre.onerror = function () {};
    pre.src = ch.logo;
  }

  function setLogo(imgEl, src) {
    if (!imgEl) return;
    imgEl.removeAttribute('src');
    imgEl.style.display = 'none';
    if (!src || placeholderLogos[src]) return;
    var pre = new Image();
    pre.onload = function () {
      if (pre.naturalWidth < 8 || pre.naturalHeight < 8) return;
      imgEl.src = src;
      imgEl.style.display = '';
    };
    pre.onerror = function () {};
    pre.src = src;
  }

  function zap(delta) {
    if (!visibleChannels.length || !currentChannel) return;
    var idx = visibleChannels.findIndex(function (c) { return c.id === currentChannel.id; });
    if (idx < 0) idx = 0;
    var next = visibleChannels[(idx + delta + visibleChannels.length) % visibleChannels.length];
    if (next) { swapSession = null; openPlayer(next); }
  }

  // "Canal flip" — volta pro último canal assistido (botão AZUL no LG).
  function zapLast() {
    if (!lastChannel) {
      var el = document.getElementById('toast');
      if (el) {
        el.className = 'toast';
        el.innerHTML = '↔ Sem canal anterior ainda';
        el.classList.remove('hidden');
        clearTimeout(favToastTimer);
        favToastTimer = setTimeout(function () { el.classList.add('hidden'); }, 1800);
      }
      return;
    }
    if (currentChannel && lastChannel.id === currentChannel.id) return;
    swapSession = null;
    openPlayer(lastChannel);
  }

  function togglePlayerList() {
    playerListVisible = !playerListVisible;
    if (playerListVisible) {
      renderPlayerList();
      playerListEl.classList.remove('hidden');
      setTimeout(function () {
        var first = playerListBodyEl.querySelector('.focusable');
        if (first) global.MeflyNav.setFocus(first);
      }, 50);
    } else {
      playerListEl.classList.add('hidden');
    }
  }

  var plRenderToken = 0;
  function renderPlayerList() {
    playerListBodyEl.innerHTML = '';
    var token = ++plRenderToken;
    var max = Math.min(visibleChannels.length, 5000);
    var i = 0, BATCH = 40;
    function buildOne(ch) {
      var btn = document.createElement('button');
      btn.className = 'player-list-item focusable' + (currentChannel && ch.id === currentChannel.id ? ' current' : '');
      var thumb = document.createElement('div');
      thumb.className = 'thumb';
      var mono = document.createElement('span');
      mono.className = 'mono-letter';
      mono.textContent = monogram(ch.name);
      thumb.appendChild(mono);
      attachLogo(thumb, ch.logo);
      var name = document.createElement('span'); name.className = 'name'; name.textContent = ch.name;
      btn.appendChild(thumb); btn.appendChild(name);
      btn.onclick = (function (chRef) { return function () { togglePlayerList(); openPlayer(chRef); }; })(ch);
      return btn;
    }
    // Lote inicial síncrono
    var frag = document.createDocumentFragment();
    var n1 = Math.min(BATCH, max);
    for (; i < n1; i++) frag.appendChild(buildOne(visibleChannels[i]));
    playerListBodyEl.appendChild(frag);
    function tick() {
      if (token !== plRenderToken) return;
      var f = document.createDocumentFragment();
      var end = Math.min(i + BATCH, max);
      for (; i < end; i++) f.appendChild(buildOne(visibleChannels[i]));
      playerListBodyEl.appendChild(f);
      if (i < max) setTimeout(tick, 30);
    }
    if (i < max) setTimeout(tick, 30);
  }

  function pushDigit(d) {
    numEntry += d;
    if (numEntry.length > 4) numEntry = numEntry.slice(-4);
    if (numDigitsEl) numDigitsEl.textContent = numEntry;
    if (numEntryEl) numEntryEl.classList.add('show');
    clearTimeout(numEntryTimer);
    numEntryTimer = setTimeout(commitNumEntry, 2000);
  }
  function commitNumEntry() {
    clearTimeout(numEntryTimer);
    var n = parseInt(numEntry, 10);
    numEntry = '';
    if (numEntryEl) numEntryEl.classList.remove('show');
    if (!n || n < 1) return;
    var idx = Math.min(n, visibleChannels.length) - 1;
    var target = visibleChannels[idx];
    if (target) openPlayer(target);
  }
  function cancelNumEntry() {
    clearTimeout(numEntryTimer);
    numEntry = '';
    if (numEntryEl) numEntryEl.classList.remove('show');
  }

  function playerKeyHandler(e, k) {
    if (playerEl.classList.contains('hidden')) return false;
    var KEY = global.MeflyNav.KEY;

    var digit = -1;
    if (k >= 48 && k <= 57) digit = k - 48;
    else if (k >= 96 && k <= 105) digit = k - 96;
    if (digit >= 0) {
      if (playerListVisible) togglePlayerList();
      pushDigit(String(digit));
      return true;
    }

    if (numEntry) {
      if (k === KEY.OK || k === KEY.ENTER) { commitNumEntry(); return true; }
      if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) { cancelNumEntry(); return true; }
    }

    if (playerListVisible) {
      if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) {
        togglePlayerList();
        return true;
      }
      return false;
    }

    // ===== Atalhos do D-pad — funcionam em QUALQUER controle =====
    // Pensado especialmente pros controles Android TV/TCL, que NÃO têm botões
    // coloridos nem teclado numérico. ◀ favorita, ▶ alterna Ao vivo/Estável.
    if (k === KEY.LEFT) { toggleFavoriteCurrent(); return true; }
    if (k === KEY.RIGHT) { togglePlaybackMode(); return true; }

    // ===== Atalhos dos botões coloridos (LG Magic Remote / TVs com 4 cores) =====
    // O Android TV/TCL ignora esses — não tem botões coloridos, então as teclas
    // nunca chegam. Pra LG eles dão acesso rápido às ações sem ter que mexer
    // no D-pad:
    //   VERMELHO = abre a lista de canais (zapping rápido)
    //   VERDE    = favoritar o canal atual
    //   AMARELO  = alterna Ao vivo / Estável
    //   AZUL     = volta pro canal anterior (canal flip clássico)
    if (k === KEY.RED) { togglePlayerList(); return true; }
    if (k === KEY.GREEN || isFavKey(k)) { toggleFavoriteCurrent(); return true; }
    if (k === KEY.YELLOW) { togglePlaybackMode(); return true; }
    if (k === KEY.BLUE) { zapLast(); return true; }

    // ===== Zapping vertical + OSD info =====
    if (k === KEY.UP || k === KEY.CHUP) { zap(-1); showOSD(); return true; }
    if (k === KEY.DOWN || k === KEY.CHDOWN) { zap(1); showOSD(); return true; }
    // OK = abre o "visualizador" — mesmo card de info+atalhos que aparece ao
    // trocar canal. Antes abria a lista de canais; agora só info. Pra abrir
    // a lista: VERMELHO (LG) ou volte ao app principal (Android TV).
    if (k === KEY.OK) { showOSD(); return true; }
    if (k === KEY.PLAY) { try { videoEl.play(); } catch (_) {} return true; }
    if (k === KEY.PAUSE) { try { videoEl.pause(); } catch (_) {} return true; }
    return false;
  }
  function isFavKey(k) { return k === 417 || k === 10252 || k === 502 || k === 2071 || k === 1052; }

  function toggleFavoriteCurrent() {
    if (!currentChannel) return;
    var nowFav = global.MeflyStorage.toggleFavorite(currentChannel);
    showFavFeedback(nowFav);
    showOSD();
  }

  // Alterna AO VIVO ⟷ ESTÁVEL no player (tecla AMARELA). 'live' = colado no
  // agora (jogo/notícia); 'stable' = com buffer, engole quedas (com atraso).
  // O player reaplica na hora recriando o stream no novo modo.
  var lastModeToggle = 0;
  function togglePlaybackMode() {
    if (!global.MeflyPlayer || !global.MeflyPlayer.setMode) return;
    var now = Date.now();
    if (now - lastModeToggle < 1500) return; // evita disparo repetido (hold/auto-repeat)
    lastModeToggle = now;
    var cur = global.MeflyPlayer.getMode ? global.MeflyPlayer.getMode() : 'live';
    var next = cur === 'stable' ? 'live' : 'stable';
    global.MeflyPlayer.setMode(next);
    var el = document.getElementById('toast');
    if (el) {
      el.className = 'toast';
      el.innerHTML = next === 'live'
        ? '📡 <b>Ao vivo</b> — sem atraso (ideal pra jogo/notícia)'
        : '🛡️ <b>Estável</b> — com buffer, evita travar (com atraso)';
      el.classList.remove('hidden');
      clearTimeout(favToastTimer);
      favToastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2600);
    }
    showOSD();
  }
  var favToastTimer = null;
  function showFavFeedback(isFav) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.className = 'toast ' + (isFav ? 'success' : '');
    el.innerHTML = (isFav ? '❤️ Adicionado aos Favoritos' : '🤍 Removido dos Favoritos');
    el.classList.remove('hidden');
    clearTimeout(favToastTimer);
    favToastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2200);
  }
  function showRecoveryToast(names) {
    var el = document.getElementById('toast');
    if (!el) return;
    var label = names.length === 1
      ? names[0] + ' voltou ao ar 🎉'
      : names.length + ' addons reconectados 🎉';
    el.className = 'toast success';
    el.innerHTML = label;
    el.classList.remove('hidden');
    clearTimeout(favToastTimer);
    favToastTimer = setTimeout(function () { el.classList.add('hidden'); }, 3500);
  }

  function renderFavorites() {
    if (!favGridEl) return;
    var favs = global.MeflyStorage.loadFavorites();
    favGridEl.innerHTML = '';
    if (!favs.length) {
      favEmptyEl.classList.remove('hidden');
      favStatusEl.textContent = 'Nenhum favorito ainda';
      return;
    }
    favEmptyEl.classList.add('hidden');
    favStatusEl.textContent = favs.length + (favs.length === 1 ? ' canal favorito' : ' canais favoritos');
    renderGrid(favGridEl, favs);
  }

  function stopBgCapture() {
    liveBgQueue = [];
    // Se tem captura no meio, deixa terminar — só esvazia a fila pra não
    // continuar pegando próximos. O frameInflight termina sozinho.
  }

  global.MeflyUIChannels = {
    init: init,
    load: load,
    renderFavorites: renderFavorites,
    renderLive: renderLive,
    stopBgCapture: stopBgCapture
  };
})(window);

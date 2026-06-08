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
  var playerListEl, playerListBodyEl, playerHintEl;
  var currentChannel = null;
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

    if (searchInputEl) {
      searchInputEl.addEventListener('input', function () {
        searchTerm = searchInputEl.value || '';
        clearTimeout(searchTimer);
        searchTimer = setTimeout(applyFilter, 250);
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

  function attachLogo(avatarEl, src) {
    if (!src) return;
    if (placeholderLogos[src]) return;
    loadLogoNow(avatarEl, src);
  }
  function loadLogoNow(avatarEl, src) {
    if (!src) return;
    var pre = new Image();
    pre.onload = function () {
      if (pre.naturalWidth < 8 || pre.naturalHeight < 8) return;
      var mono = avatarEl.querySelector('.mono-letter');
      if (mono) mono.parentNode.removeChild(mono);
      avatarEl.classList.add('has-logo');
      avatarEl.removeAttribute('data-tone');
      var img = document.createElement('img');
      img.alt = ''; img.decoding = 'async'; img.src = src;
      img.style.opacity = '0'; img.style.transition = 'opacity 0.25s ease';
      avatarEl.appendChild(img);
      requestAnimationFrame(function () { img.style.opacity = '1'; });
    };
    pre.onerror = function () {};
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
    var live = allChannels.filter(function (c) { return !dead[c.id]; });
    if (!live.length) {
      liveGridEl.innerHTML = '';
      liveEmptyEl.classList.remove('hidden');
      if (liveSubEl) liveSubEl.textContent = '';
      return;
    }
    var ranked = live.slice().sort(function (a, b) { return liveScore(b) - liveScore(a); });
    var pick = ranked.slice(0, 16);
    liveEmptyEl.classList.add('hidden');
    if (liveSubEl) liveSubEl.textContent = pick.length + ' destaques · ' + nowHHMM();

    liveGridEl.innerHTML = '';
    var frag = document.createDocumentFragment();
    for (var i = 0; i < pick.length; i++) frag.appendChild(makeLiveTile(pick[i]));
    liveGridEl.appendChild(frag);
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

  function renderGrid(el, list) {
    if (!el) return;
    el.innerHTML = '';
    if (!list.length) return;
    var max = Math.min(list.length, 5000);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < max; i++) frag.appendChild(makeChannelCard(list[i]));
    el.appendChild(frag);
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

  // ===== PLAYER =====
  function openPlayer(ch) {
    currentChannel = ch;
    playerEl.classList.remove('hidden');
    errorOverlay.classList.add('hidden');
    loadingOverlay.classList.remove('hidden');
    showOSD();
    setLogo(loadingLogoEl, ch.logo);
    loadingTextEl.textContent = 'Sintonizando ' + ch.name + '…';

    global.MeflyNav.pushBackHandler(closePlayer);
    global.MeflyNav.addKeyHandler(playerKeyHandler);

    global.MeflyAddons.resolveStream(ch).then(function (url) {
      global.MeflyPlayer.play(videoEl, url, {
        onLoading: function () { loadingOverlay.classList.remove('hidden'); errorOverlay.classList.add('hidden'); },
        onPlaying: function () { loadingOverlay.classList.add('hidden'); errorOverlay.classList.add('hidden'); },
        onError: function (msg) {
          loadingOverlay.classList.add('hidden');
          errorOverlay.classList.remove('hidden');
          errorTitleEl.textContent = ch.name;
          errorTextEl.textContent = msg || 'Canal indisponível.';
        },
        onDead: function () { global.MeflyStorage.markDead(ch.id); }
      });
    }).catch(function (e) {
      loadingOverlay.classList.add('hidden');
      errorOverlay.classList.remove('hidden');
      errorTitleEl.textContent = ch.name;
      errorTextEl.textContent = 'Este canal está sem transmissão no momento.';
      global.MeflyStorage.markDead(ch.id);
      console.warn('[stream]', e && e.message);
    });
  }

  function closePlayer() {
    if (playerEl.classList.contains('hidden')) return;
    cancelNumEntry();
    global.MeflyPlayer.stop();
    playerEl.classList.add('hidden');
    playerListEl.classList.add('hidden');
    playerListVisible = false;
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
    if (next) openPlayer(next);
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

  function renderPlayerList() {
    playerListBodyEl.innerHTML = '';
    var max = Math.min(visibleChannels.length, 5000);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < max; i++) {
      var ch = visibleChannels[i];
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
      (function (chRef) { btn.onclick = function () { togglePlayerList(); openPlayer(chRef); }; })(ch);
      frag.appendChild(btn);
    }
    playerListBodyEl.appendChild(frag);
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

    if (k === KEY.GREEN || isFavKey(k)) { toggleFavoriteCurrent(); return true; }

    if (k === KEY.UP || k === KEY.CHUP) { zap(-1); showOSD(); return true; }
    if (k === KEY.DOWN || k === KEY.CHDOWN) { zap(1); showOSD(); return true; }
    if (k === KEY.OK) { togglePlayerList(); return true; }
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

  global.MeflyUIChannels = {
    init: init,
    load: load,
    renderFavorites: renderFavorites,
    renderLive: renderLive
  };
})(window);

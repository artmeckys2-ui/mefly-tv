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
  var currentSubGroup = 'todos'; // 'todos' ou id de BROADCASTERS (só vale em Populares)
  var searchTerm = '';
  var searchTimer = null;
  var dead = {};
  var placeholderLogos = {};

  // ===== ELEMENTOS =====
  var groupsEl, subGroupsEl, gridEl, emptyEl, statusEl, searchInputEl;
  var channelsProgressEl, channelsProgressBarEl, channelsProgressPercentEl;
  var channelsProgressValue = 0;
  var channelsVisualProgressTimer = null;
  var favGridEl, favEmptyEl, favStatusEl;
  var liveGridEl, liveEmptyEl, liveSubEl;
  var channelScrollIndicatorEl, channelScrollLetterEl, channelScrollThumbEl;
  var channelScrollPickerEl, channelScrollPickerOpen = false;
  var channelsLoadComplete = true;
  var channelLoadGeneration = 0;
  var channelLoadGroupTouched = false;

  // ===== CATEGORIAS =====
  var CATS_ORDER = ['Principais', 'Esportes', 'Filmes', 'Notícias', 'Infantil', 'Música', 'Brasil', 'Argentina'];
  var CAT_LABEL = {
    'MaisVistos': 'Mais assistidos',
    'Todos':      'Todas',
    'Principais': 'Populares',
    'Esportes':   'Esportes',
    'Filmes':     'Filmes',
    'Notícias':   'Notícias',
    'Infantil':   'Infantil',
    'Música':     'Música',
    'Brasil':     'Brasil',
    'Argentina':  'Argentina'
  };
  var CAT_ICON = {
    'MaisVistos': '⭐',
    'Todos':      '✦',
    'Principais': '🔥',
    'Esportes':   '⚽',
    'Filmes':     '🎬',
    'Notícias':   '📰',
    'Infantil':   '🧸',
    'Música':     '🎵',
    'Brasil':     '🇧🇷',
    'Argentina':  '🇦🇷'
  };
  var CAT_PATTERNS = [
    ['Esportes',   /\b(sports?|sportv|spor\s*tv|esportes?|futebol|gol\b|champion|premier|nba|nfl|ufc|combate|f1|fórmula|formula|tnt\s*sports|band\s*sports|nsports|n\s*sports|nosso\s*futebol|canal\s*goat|goat|espn|caz[eé]|premiere)\b/i],
    ['Filmes',     /\b(movie|filme|cinema|hbo|telecine|megapix|warner|paramount|sony|universal|fox|cinemax|amc|a&e|axn)\b/i],
    ['Notícias',   /\b(news|not[ií]cia|globo ?news|cnn|band ?news|record ?news|jovem pan|globo rural|jornal)\b/i],
    ['Infantil',   /\b(kids|infantil|child|gloob|cartoon|nick|disney|baby|discovery kids|tooncast|boomerang|tiny pop)\b/i],
    ['Música',     /\b(m[uú]sica|music|mtv|multishow|bis|hits|vh1|sertanejo)\b/i]
  ];
  function classifyChannel(c) {
    var sportsOverride = global.MeflyStorage && global.MeflyStorage.getSportsOverride(c);
    if (sportsOverride === true) return 'Esportes';
    var hay = (String(c.group || '') + ' ' + String(c.name || '')).toLowerCase();
    for (var i = 0; i < CAT_PATTERNS.length; i++) {
      if (CAT_PATTERNS[i][1].test(hay)) {
        if (sportsOverride === false && CAT_PATTERNS[i][0] === 'Esportes') continue;
        return CAT_PATTERNS[i][0];
      }
    }
    return 'Música';
  }
  var MAIN_RE = /\b(globo|gnt|globonews|sbt|record(\s|news|tv)|band(\s|news|sports|eirantes)?|rede ?tv|cultura|cnn brasil|jovem pan|tv brasil|sportv|premiere|espn|cazé|tnt|telecine|warner|discovery|hbo|megapix|multishow|gloob|cartoon|disney|nickelodeon|viva|canal brasil)\b/i;
  function isMainChannel(c) { return MAIN_RE.test(String(c.name || '')); }

  function channelCountry(c) {
    var context = [c.tvgId, c.group, c.name, c.country, c.countryCode].join(' ');
    if (isBrazilianSportsChannel(c) || /(?:\.br\b|\b(?:brasil|brazil|brasileir[oa]s?|pt[- ]?br)\b)/i.test(context)) return 'Brasil';
    if (/(?:\.ar\b|\b(?:argentina|arg)\b)/i.test(context)) return 'Argentina';
    return '';
  }

  // ===== "EMISSORAS" — sub-categorias dentro de Populares =====
  // Os canais "abertos" brasileiros (Globo, SBT, Record, Band) aparecem MUITAS
  // vezes na lista — uma vez por região (SP/RJ/MG…), por qualidade (HD/FHD/4K)
  // e por fonte/CDN (origin, mirror, backup). Pra dar pé de ir direto na
  // emissora que interessa, os Populares ganham 4 sub-abas fixas + outras
  // emissoras que também acumulam (SporTV/ESPN/Premiere, redes esportivas).
  // As exclusões evitam que Globo News caia em Globo, Record News em Record,
  // Band News/Sports em Band — eles são canais distintos.
  var BROADCASTERS = [
    { id: 'globo',    label: 'Globo',    icon: '📺', re: /\bglobo\b(?!\s*(news|rural|sat|play))/i },
    { id: 'sbt',      label: 'SBT',      icon: '🟦', re: /\bsbt\b/i },
    { id: 'record',   label: 'Record',   icon: '🔴', re: /\brecord\b(?!\s*(news|international))/i },
    { id: 'band',     label: 'Band',     icon: '🟩', re: /\bband(eirantes)?\b(?!\s*(news|sports))/i },
    { id: 'sportv',   label: 'SporTV',   icon: '⚽', re: /\bsport\s*tv\b/i },
    { id: 'espn',     label: 'ESPN',     icon: '🏈', re: /\bespn\b/i },
    { id: 'premiere', label: 'Premiere', icon: '🎬', re: /\bpremiere\b/i }
  ];
  // Sempre exibimos as 4 primeiras (Globo/SBT/Record/Band) mesmo com poucos
  // resultados — são os atalhos que o usuário pediu. As demais só aparecem
  // quando têm massa crítica (BROADCASTER_MIN ou mais canais).
  var BROADCASTER_ALWAYS = { 'globo': 1, 'sbt': 1, 'record': 1, 'band': 1 };
  var BROADCASTER_MIN = 4;
  function broadcasterOf(c) {
    var name = String(c.name || '');
    for (var i = 0; i < BROADCASTERS.length; i++) {
      if (BROADCASTERS[i].re.test(name)) return BROADCASTERS[i].id;
    }
    return null;
  }

  // ===== "MAIS ASSISTIDOS" — categoria principal ao abrir =====
  // Canais com +10min de exibição acumulada (storage), do mais RECENTE pro mais
  // antigo. Prefere o objeto "vivo" de allChannels (url/qualidade atualizadas);
  // se a fonte sumiu, cai na cópia salva. Mortos ficam de fora.
  function getMostWatchedChannels() {
    var stored = (global.MeflyStorage.mostWatched && global.MeflyStorage.mostWatched()) || [];
    if (!stored.length) return [];
    var byId = {};
    for (var i = 0; i < allChannels.length; i++) byId[allChannels[i].id] = allChannels[i];
    var out = [], seen = {};
    for (var j = 0; j < stored.length; j++) {
      var s = stored[j];
      if (!s || !s.id || seen[s.id] || dead[s.id]) continue;
      seen[s.id] = 1;
      out.push(byId[s.id] || s);
    }
    return out;
  }

  // ===== PLAYER STATE =====
  var playerEl, videoEl, osdEl, osdNumberEl, osdNameEl, osdNameTextEl, osdNameCopyEl, osdLogoEl, osdGroupEl, osdFavEl;
  var loadingOverlay, errorOverlay, errorTitleEl, errorTextEl, loadingTextEl, loadingLogoEl;
  var playerListEl, playerListBodyEl, loadingLogoWrap, loadingLogoMono;
  var channelPasscodeModalEl, channelPasscodeInputEl, channelPasscodeErrorEl;
  var btnChannelPasscodeCancel, btnChannelPasscodeSubmit;
  var pendingProtectedChannel = null, pendingProtectedOptions = null, protectedChannelReturnFocus = null;
  var currentChannel = null;
  var lastChannel = null; // canal anterior pro AZUL (zap-back / "flip" clássico)
  var playerListVisible = false;
  var playerChannelList = [];
  var osdTimer = null;
  var numEntry = '', numEntryTimer = null, numEntryEl = null, numDigitsEl = null;

  function init() {
    groupsEl = document.getElementById('groups');
    subGroupsEl = document.getElementById('sub-groups');
    gridEl = document.getElementById('channels-grid');
    channelScrollIndicatorEl = document.getElementById('channel-scroll-indicator');
    channelScrollLetterEl = document.getElementById('channel-scroll-letter');
    channelScrollThumbEl = document.getElementById('channel-scroll-thumb');
    channelScrollPickerEl = document.getElementById('channel-scroll-picker');
    if (channelScrollLetterEl) channelScrollLetterEl.onclick = toggleChannelScrollPicker;
    emptyEl = document.getElementById('channels-empty');
    statusEl = document.getElementById('channels-status');
    channelsProgressEl = document.getElementById('channels-progress');
    channelsProgressBarEl = document.getElementById('channels-progress-bar');
    channelsProgressPercentEl = document.getElementById('channels-progress-percent');
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
    osdNameTextEl = document.getElementById('osd-name-text');
    osdNameCopyEl = document.getElementById('osd-name-copy');
    osdLogoEl = document.getElementById('osd-logo');
    osdGroupEl = document.getElementById('osd-group');
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
    channelPasscodeModalEl = document.getElementById('channel-passcode-modal');
    channelPasscodeInputEl = document.getElementById('channel-passcode-input');
    channelPasscodeErrorEl = document.getElementById('channel-passcode-error');
    btnChannelPasscodeCancel = document.getElementById('btn-channel-passcode-cancel');
    btnChannelPasscodeSubmit = document.getElementById('btn-channel-passcode-submit');
    if (btnChannelPasscodeCancel) btnChannelPasscodeCancel.onclick = cancelChannelPasscode;
    if (btnChannelPasscodeSubmit) btnChannelPasscodeSubmit.onclick = submitChannelPasscode;
    if (channelPasscodeInputEl) {
      channelPasscodeInputEl.addEventListener('input', function () {
        channelPasscodeInputEl.value = channelPasscodeInputEl.value.replace(/\D/g, '').slice(0, 4);
      });
      channelPasscodeInputEl.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.keyCode === 13) {
          event.preventDefault();
          submitChannelPasscode();
        }
      });
    }
    numEntryEl = document.getElementById('ch-num-entry');
    numDigitsEl = document.getElementById('cne-digits');

    // Grid virtualizado: re-renderiza a janela quando o foco se aproxima da borda.
    if (global.MeflyNav && global.MeflyNav.onFocusChange) {
      global.MeflyNav.onFocusChange(onGridFocus);
    }
    detectPlatform();
  }

  // Marca a plataforma no <body> pra as dicas de tecla certas aparecerem:
  //   LG (webOS) → indicadores por COR (vermelho/verde/amarelo/azul).
  //   TCL/Android (e navegador) → indicadores por BOTÃO (◀ ▶ ↑↓ OK), sem cores.
  function detectPlatform() {
    var ua = (navigator.userAgent || '').toLowerCase();
    var isLG = ua.indexOf('web0s') !== -1 || ua.indexOf('webos') !== -1;
    document.body.classList.add(isLG ? 'platform-lg' : 'platform-tcl');
  }

  function captureChannelFocus() {
    var focus = global.MeflyNav && global.MeflyNav.getFocus();
    var screen = document.querySelector('.screen.active');
    if (!focus || !screen || !screen.contains(focus)) return null;
    if (focus.classList.contains('channel')) {
      return { screen: screen.id, type: 'channel', id: focus.getAttribute('data-id') };
    }
    if (focus.classList.contains('cat-chip')) {
      return { screen: screen.id, type: 'category', value: focus.getAttribute('data-cat') };
    }
    if (focus.classList.contains('sub-chip')) {
      return { screen: screen.id, type: 'sub', value: focus.getAttribute('data-sub') };
    }
    return focus.id ? { screen: screen.id, type: 'id', value: focus.id } : null;
  }

  function restoreChannelFocus(snapshot) {
    if (!snapshot) return;
    var screen = document.querySelector('.screen.active');
    if (!screen || screen.id !== snapshot.screen) return;
    var target = null;
    if (snapshot.type === 'category' || snapshot.type === 'sub') {
      var container = snapshot.type === 'category' ? groupsEl : subGroupsEl;
      var selector = snapshot.type === 'category' ? '.cat-chip' : '.sub-chip';
      var attribute = snapshot.type === 'category' ? 'data-cat' : 'data-sub';
      var items = container ? container.querySelectorAll(selector) : [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].getAttribute(attribute) === snapshot.value) { target = items[i]; break; }
      }
    } else if (snapshot.type === 'id') {
      target = document.getElementById(snapshot.value);
    } else if (snapshot.type === 'channel') {
      var grid = snapshot.screen === 'screen-live' ? liveGridEl : gridEl;
      var view = null;
      for (var v = 0; v < gridViews.length; v++) {
        if (gridViews[v].el === grid) { view = gridViews[v]; break; }
      }
      if (view) {
        var index = -1;
        for (var j = 0; j < view.list.length; j++) {
          if (String(view.list[j].id) === String(snapshot.id)) { index = j; break; }
        }
        if (index >= 0) {
          renderWindow(view, Math.floor(index / view.cols));
          var cards = grid.querySelectorAll('.channel');
          for (var c = 0; c < cards.length; c++) {
            if (cards[c].getAttribute('data-id') === String(snapshot.id)) { target = cards[c]; break; }
          }
        }
      }
    }
    if (target) global.MeflyNav.setFocus(target);
  }

  function updateChannelsProgress(result) {
    if (!channelsProgressEl) return;
    var complete = !!(result && result.complete);
    var progress = channelsProgressValue;
    if (complete) {
      progress = 100;
      channelsProgressValue = 100;
    }
    channelsProgressEl.classList.toggle('hidden', complete);
    channelsProgressEl.setAttribute('aria-valuenow', String(progress));
    channelsProgressBarEl.style.width = progress + '%';
    channelsProgressPercentEl.textContent = progress + '%';
    if (statusEl && !searchTerm && !channelsLoadComplete) {
      var totalLive = allChannels.filter(function (c) { return !dead[c.id]; }).length;
      if (totalLive > 0) statusEl.textContent = totalLive + ' canais ao vivo';
      else statusEl.textContent = 'Carregando canais…';
    }
  }

  function stopChannelsVisualProgress() {
    if (channelsVisualProgressTimer) {
      clearInterval(channelsVisualProgressTimer);
      channelsVisualProgressTimer = null;
    }
  }

  function startChannelsVisualProgress() {
    stopChannelsVisualProgress();
    channelsVisualProgressTimer = setInterval(function () {
      if (channelsLoadComplete) {
        stopChannelsVisualProgress();
        return;
      }
      var current = Number(channelsProgressValue) || 0;
      var next = Math.min(94, current + (current < 30 ? 2 : current < 65 ? 3 : 4));
      channelsProgressValue = next;
      if (channelsProgressEl) {
        channelsProgressEl.setAttribute('aria-valuenow', String(next));
        channelsProgressBarEl.style.width = next + '%';
        channelsProgressPercentEl.textContent = next + '%';
      }
      if (statusEl && !searchTerm) {
        var totalLive = allChannels.filter(function (c) { return !dead[c.id]; }).length;
        if (totalLive > 0) statusEl.textContent = totalLive + ' canais ao vivo';
        else statusEl.textContent = 'Carregando canais…';
      }
    }, 550);
  }

  function load(onDone) {
    var requestId = ++channelLoadGeneration;
    channelsLoadComplete = false;
    channelLoadGroupTouched = false;
    channelsProgressValue = 0;
    stopChannelsVisualProgress();
    startChannelsVisualProgress();
    updateChannelsProgress({ complete: false, progress: 0 });
    var addons = global.MeflyStorage.loadAddons();
    dead = global.MeflyStorage.loadDead();

    function applyResult(result) {
      if (requestId !== channelLoadGeneration) return;
      var focusState = captureChannelFocus();
      allChannels = result.channels || [];
      channelsLoadComplete = !!result.complete;
      if (channelsLoadComplete) stopChannelsVisualProgress();
      updateChannelsProgress(result);
      detectPlaceholderLogos();

      if (result.complete && result.recovered && result.recovered.length) {
        showRecoveryToast(result.recovered);
      }

      if (result.complete && !channelLoadGroupTouched) {
        try {
          var saved = localStorage.getItem('mefly_tv_last_group');
          if (saved && (saved === 'Todos' || saved === 'Principais' || saved === 'MaisVistos' ||
            saved === 'Esportes' || saved === 'Brasil' || saved === 'Argentina' ||
              allChannels.some(function (c) { return String(c.group || '').trim() === saved; }))) {
            currentGroup = saved;
          }
          var savedSub = localStorage.getItem('mefly_tv_last_subgroup');
          if (savedSub === 'todos' || (savedSub && BROADCASTERS.some(function (b) { return b.id === savedSub; }))) {
            currentSubGroup = savedSub;
          }
        } catch (_) {}
        if (getMostWatchedChannels().length) currentGroup = 'MaisVistos';
      }

      buildTwinIndex();
      var screen = document.querySelector('.screen.active');
      if (screen && screen.id === 'screen-channels') {
        renderChannels();
        restoreChannelFocus(focusState);
      } else if (screen && screen.id === 'screen-live') {
        renderLive();
        restoreChannelFocus(focusState);
      }
    }

    var activeScreen = document.querySelector('.screen.active');
    if (activeScreen && activeScreen.id === 'screen-channels') renderChannels();
    else if (activeScreen && activeScreen.id === 'screen-live') renderLive();
    if (typeof onDone === 'function') onDone();

    return global.MeflyChannels.loadAll(addons, function (result) {
      applyResult(result);
    }).then(function (result) {
      applyResult(result);
    }).catch(function (error) {
      if (requestId !== channelLoadGeneration) return;
      channelsLoadComplete = true;
      stopChannelsVisualProgress();
      updateChannelsProgress({ complete: true, progress: 100 });
      statusEl.textContent = 'Erro ao carregar canais';
      emptyEl.classList.remove('hidden');
      console.error('[channels load]', error);
    });
  }

  function renderChannels() {
    dead = global.MeflyStorage.loadDead();
    renderGroups();
    renderLive();
    applyFilter();
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

  // ===== CHIPS =====
  function renderGroups() {
    var live = allChannels.filter(function (c) { return !dead[c.id]; });
    var counts = { 'Todos': live.length, 'Principais': 0, 'Esportes': 0, 'Filmes': 0,
             'Notícias': 0, 'Infantil': 0, 'Música': 0,
             'Brasil': 0, 'Argentina': 0 };
    for (var i = 0; i < live.length; i++) {
      var c = live[i];
      if (isMainChannel(c)) counts['Principais']++;
      var cat = classifyChannel(c);
      if (counts[cat] !== undefined) counts[cat]++;
      var country = channelCountry(c);
      if (counts[country] !== undefined) counts[country]++;
    }
    groupsEl.innerHTML = '';
    // "Mais assistidos" é a 1ª categoria, mas só aparece quando já existe
    // algum canal com +10min de exibição.
    var most = getMostWatchedChannels();
    counts['MaisVistos'] = most.length;
    if (channelsLoadComplete && currentGroup !== 'Todos' && !counts[currentGroup]) currentGroup = 'Todos';
    var list = [];
    if (most.length) list.push('MaisVistos');
    list.push('Todos');
    for (var k = 0; k < CATS_ORDER.length; k++) {
      if (counts[CATS_ORDER[k]] > 0 || (!channelsLoadComplete && currentGroup === CATS_ORDER[k])) {
        list.push(CATS_ORDER[k]);
      }
    }
    for (var j = 0; j < list.length; j++) {
      groupsEl.appendChild(makeCatChip(list[j], counts[list[j]]));
    }
    renderSubGroups(live);
  }

  // Sub-rail só aparece na categoria "Populares". Conta canais por emissora
  // entre os Populares e renderiza os chips. Sempre mostra Globo/SBT/Record/Band
  // (mesmo com poucos resultados); outras emissoras só se tiverem massa.
  function renderSubGroups(live) {
    if (!subGroupsEl) return;
    if (currentGroup !== 'Principais') {
      subGroupsEl.classList.add('hidden');
      subGroupsEl.innerHTML = '';
      return;
    }
    var principais = live.filter(isMainChannel);
    var counts = { 'todos': principais.length };
    for (var b = 0; b < BROADCASTERS.length; b++) counts[BROADCASTERS[b].id] = 0;
    for (var i = 0; i < principais.length; i++) {
      var id = broadcasterOf(principais[i]);
      if (id) counts[id]++;
    }
    subGroupsEl.innerHTML = '';
    subGroupsEl.appendChild(makeSubChip('todos', 'Todos', '✦', counts.todos));
    for (var k = 0; k < BROADCASTERS.length; k++) {
      var bc = BROADCASTERS[k];
      if (BROADCASTER_ALWAYS[bc.id] || counts[bc.id] >= BROADCASTER_MIN) {
        subGroupsEl.appendChild(makeSubChip(bc.id, bc.label, bc.icon, counts[bc.id]));
      }
    }
    // Se a sub-aba persistida não existe mais (emissora sem canais agora),
    // cai pra "Todos" pra não filtrar pro vazio.
    if (currentSubGroup !== 'todos' && counts[currentSubGroup] === 0) {
      currentSubGroup = 'todos';
      var chips = subGroupsEl.querySelectorAll('.sub-chip');
      for (var c = 0; c < chips.length; c++) {
        chips[c].classList.toggle('selected', chips[c].getAttribute('data-sub') === 'todos');
      }
    }
    subGroupsEl.classList.remove('hidden');
  }

  function makeSubChip(id, label, icon, count) {
    var btn = document.createElement('button');
    btn.className = 'sub-chip focusable' + (id === currentSubGroup ? ' selected' : '');
    btn.setAttribute('data-sub', id);
    var ic = document.createElement('span'); ic.className = 'sc-ic'; ic.textContent = icon;
    var nm = document.createElement('span'); nm.className = 'sc-name'; nm.textContent = label;
    var ct = document.createElement('span'); ct.className = 'sc-count'; ct.textContent = count;
    btn.appendChild(ic); btn.appendChild(nm); btn.appendChild(ct);
    btn.onclick = function () { selectSubGroup(id); };
    return btn;
  }

  function selectSubGroup(id) {
    currentSubGroup = id;
    try { localStorage.setItem('mefly_tv_last_subgroup', id); } catch (_) {}
    if (searchInputEl && searchInputEl.value) { searchInputEl.value = ''; searchTerm = ''; }
    var chips = subGroupsEl ? subGroupsEl.querySelectorAll('.sub-chip') : [];
    for (var k = 0; k < chips.length; k++) {
      chips[k].classList.toggle('selected', chips[k].getAttribute('data-sub') === id);
    }
    applyFilter();
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
    if (!channelsLoadComplete) channelLoadGroupTouched = true;
    try { localStorage.setItem('mefly_tv_last_group', name); } catch (_) {}
    if (searchInputEl && searchInputEl.value) { searchInputEl.value = ''; searchTerm = ''; }
    var chips = groupsEl.querySelectorAll('.cat-chip');
    for (var k = 0; k < chips.length; k++) {
      chips[k].classList.toggle('selected', chips[k].getAttribute('data-cat') === name);
    }
    // Atualiza sub-rail (aparece/esconde conforme a categoria escolhida)
    renderSubGroups(allChannels.filter(function (c) { return !dead[c.id]; }));
    applyFilter();
  }

  // ===== ESPORTES BR — emissoras brasileiras, sem variantes duplicadas =====
  var BRAZILIAN_TEAM_RE = /^(?:flamengo|vasco(?:\s+da\s+gama)?|fluminense|botafogo(?:\s*[- ]?\s*(?:pb|sp))?|corinthians|palmeiras|santos|s[aã]o\s+paulo|gr[eê]mio|internacional|inter|cruzeiro|atl[eé]tico(?:\s+mineiro|\s*[- ]?\s*mg|\s+goianiense|\s*[- ]?\s*go|\s+paranaense|\s*[- ]?\s*pr)?|athletico(?:\s+paranaense|\s*[- ]?\s*pr)?|galo\s+(?:tv|play|doido)|bahia|fortaleza|cear[aá]|sport\s+(?:recife|club(?:e)?\s+do\s+recife)|vit[oó]ria|red\s+bull\s+bragantino|bragantino|goi[aá]s|coritiba|cuiab[aá]|juventude|crici[uú]ma|am[eé]rica\s+(?:mineiro|mg|rn)|chapecoense|ava[ií]|ponte\s+preta|guarani|n[aá]utico|paysandu|remo|crb|csa|abc|sampaio\s+corr[eê]a|vila\s+nova|novorizontino|mirassol|oper[aá]rio(?:\s+ferrovi[aá]rio)?|londrina|figueirense|amazonas|manaus)(?:\b|$)/i;
  var BRAZILIAN_TEAM_MENTION_RE = new RegExp(BRAZILIAN_TEAM_RE.source.replace(/^\^/, ''), 'i');

  function isBrazilianSportsChannel(ch) {
    var sportsOverride = global.MeflyStorage.getSportsOverride(ch);
    if (sportsOverride !== null) return sportsOverride;
    var name = String(ch.name || '');
    var source = String(ch.addonName || '');
    var context = [name, ch.group, ch.id, ch.tvgId, ch.country, ch.countryCode, source].join(' ');
    var hasForeignMarker = /\b(?:arg(?:entina)?|chi(?:le)?|per[uú]|colombia|ecuador|m[eé]xico|mex|mx|usa|united states|portugal|pt|paraguay|uruguay|bolivia|venezuela|internacional|international|latam|latin|latino|miami)\b/i;
    var hasBrazilianTeamEvent = BRAZILIAN_TEAM_MENTION_RE.test(name) && /(?:\bx\b|×|\bvs\.?\b|\bversus\b)/i.test(name);
    if (hasBrazilianTeamEvent && !hasForeignMarker.test(name)) return true;
    if (hasForeignMarker.test(context)) return false;
    if (/^\s*(?:py|ar|cl|pe|co|ec|mx|us|pt)\s+/i.test(name)) return false;
    if (/\bpremiere\s+sports\b/i.test(name)) return false;
    if (/^tv\s+(?:bahia|vit[oó]ria)\b/i.test(name)) return false;
    if (/\b(?:win\s*sports|gol\s*per[uú]|directv\s*sports|tyc\s*sports|bym\s*sports|bein\s*sports|sky\s*sports|sport\s*tv|tnt\s*sports\s*premium|espn\s*premium|espn\s*6|mosaico|universal|amazon|prime\s*video|apple\s*tv)\b/i.test(name)) return false;
    var teamName = name.trim()
      .replace(/^\d+\s*[|.-]\s*/, '')
      .replace(/^(?:brs|tv|canal)(?:\s*[-|:]\s*|\s+(?:do\s+)?)/i, '');
    if (hasBrazilianTeamEvent || BRAZILIAN_TEAM_RE.test(teamName) || /^galo$/i.test(teamName)) return true;
    if (classifyChannel(ch) !== 'Esportes') return false;
    var isBrazilianBrand = /\b(?:spor\s*tv|premiere(?:\s+(?:clubes?|[1-8]))?|combate|caz[eé]\s*tv|band\s*sports|nosso\s*futebol(?:\s+\d+)?|n\s*sports?|nsports|canal\s*goat(?:\s+\d+)?|ge\s*fast)\b/i.test(name);
    var isRegionalNetwork = /\b(?:espn(?:\s*(?:[1-5]|extra))?|tnt\s*sports(?:\s*[1-4])?)\b/i.test(name);
    if (!isBrazilianBrand && !isRegionalNetwork) return false;
    if (/(?:\.br\b|\b(?:brasil|brazil|brasileir[oa]s?|pt[- ]?br)\b)/i.test(context)) return true;
    if (isBrazilianBrand) return true;
    return /\b(?:fenix tv|frostview(?: tv)?)\b/i.test(source) && isRegionalNetwork;
  }

  function sportsDisplayName(ch) {
    var name = displayName(ch.name).replace(/^\s*\d+\s*[|.-]\s*/, '');
    name = name.replace(/\s*\(\s*(?:opc|op[cç][aã]o|option)\.?\s*\d+\s*\)\s*$/i, '');
    name = name.replace(/\s*\(\s*(?:brasil|brazil|br)\s*\)\s*$/i, '');
    name = name.replace(/\s+\b(?:brasil|brazil|br)\b\s*$/i, '');
    name = name.replace(/\b(espn|sportv|spor tv) 1$/i, '$1');
    if (/^premiere clubes?$/i.test(name)) return 'Premiere Clubes';
    if (/^canal\s+goat(?:\s+(?:\d+|i{1,3}²?))?$/i.test(name)) return 'Canal Goat';
    if (/^n\s*sports?(?:\s+\d+)?$/i.test(name) || /^nsports(?:\s+\d+)?$/i.test(name)) return 'N Sports';
    if (/^caz[eé]\s*tv(?:\s+(?:\d+|i{1,3}²?))?$/i.test(name) || /^caz[eé]tv(?:\s+(?:\d+|i{1,3}²?))?$/i.test(name)) return 'Cazé TV';
    return name.trim();
  }

  function sportsChannelKey(ch) {
    var matchupKey = sportsMatchupKey(ch);
    if (matchupKey) return matchupKey;
    var key = twinKey(sportsDisplayName(ch));
    key = key.replace(/\b(?:brasil|brazil)\b/g, ' ').replace(/\s+/g, ' ').trim();
    key = key.replace(/[éÉ]/g, 'e').replace(/\bcazetv\b/g, 'caze tv');
    key = key.replace(/\b(espn|sportv|spor tv) 1$/, '$1');
    return key;
  }

  function sportsQuality(ch) {
    var quality = Number(ch.quality) || 0;
    if (quality) return quality;
    var match = String(ch.name || '').match(/\b(2160|1440|1080|720|576|480)p?\b/i);
    return match ? Number(match[1]) : 0;
  }

  function sportsMatchupKey(ch) {
    var name = String(ch.name || '');
    var ball = name.lastIndexOf('⚽');
    if (ball >= 0) name = name.substring(ball + 1);
    name = name.replace(/^\s*\d{1,2}(?::\d{2}|h\d{2})\s*/i, '')
      .replace(/\s*[-|]\s*(?:jogo|op(?:c|ç)[aã]o)\s*\d+\b.*$/i, '')
      .replace(/\([^)]*\)/g, ' ');
    var matchup = name.match(/(.+?)\s+(?:x|vs\.?|versus|×)\s+(.+)/i);
    if (!matchup) return '';
    var sides = [matchup[1], matchup[2]];
    for (var i = 0; i < sides.length; i++) {
      sides[i] = sides[i].replace(/[^\wáéíóúãõç ]/ig, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    }
    sides.sort();
    return sides[0] && sides[1] ? 'match:' + sides[0] + '|' + sides[1] : '';
  }

  function getBrazilianSportsChannels() {
    var byKey = {};
    for (var i = 0; i < allChannels.length; i++) {
      var ch = allChannels[i];
      if (dead[ch.id] || !isBrazilianSportsChannel(ch)) continue;
      var key = sportsChannelKey(ch);
      if (!key) continue;
        if (!byKey[key] || sportsQuality(ch) > sportsQuality(byKey[key]) ||
          (sportsQuality(ch) === sportsQuality(byKey[key]) && sportsDisplayName(ch).length < sportsDisplayName(byKey[key]).length)) byKey[key] = ch;
    }
    var list = Object.keys(byKey).map(function (key) { return byKey[key]; });
    list.sort(function (a, b) {
      var left = sportsDisplayName(a).toLowerCase();
      var right = sportsDisplayName(b).toLowerCase();
      return left < right ? -1 : (left > right ? 1 : 0);
    });
    return list;
  }

  function renderLive() {
    if (!liveGridEl) return;
    dead = global.MeflyStorage.loadDead();
    var sports = getBrazilianSportsChannels();
    if (!sports.length) {
      liveGridEl.innerHTML = '';
      liveEmptyEl.classList.toggle('hidden', !channelsLoadComplete);
      if (liveSubEl) liveSubEl.textContent = channelsLoadComplete ? '' : 'Carregando canais…';
      updateHiddenLink();
      return;
    }
    liveEmptyEl.classList.add('hidden');
    if (liveSubEl) liveSubEl.textContent = sports.length + ' canais brasileiros de esportes';
    renderGrid(liveGridEl, sports);
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
  // ===== FILTRO + RENDER =====
  function applyFilter() {
    var q = searchTerm.trim().toLowerCase();
    var sourceChannels = currentGroup === 'Esportes' ? getBrazilianSportsChannels() : allChannels;
    if (!q && currentGroup === 'MaisVistos') {
      // Categoria "Mais assistidos": lista própria (recência), não classifica.
      visibleChannels = getMostWatchedChannels();
    } else {
      visibleChannels = sourceChannels.filter(function (c) {
        if (dead[c.id]) return false;
        if (q) return String(c.name || '').toLowerCase().indexOf(q) >= 0;
        if (currentGroup === 'Todos' || currentGroup === 'MaisVistos') return true;
        if (currentGroup === 'Brasil' || currentGroup === 'Argentina') return channelCountry(c) === currentGroup;
        if (currentGroup === 'Esportes') return true;
        if (currentGroup === 'Principais') {
          if (!isMainChannel(c)) return false;
          if (currentSubGroup === 'todos') return true;
          return broadcasterOf(c) === currentSubGroup;
        }
        return classifyChannel(c) === currentGroup;
      });
    }

    renderGrid(gridEl, visibleChannels);

    if (statusEl) {
      if (q) {
        statusEl.textContent = visibleChannels.length + ' resultado(s) para "' + searchTerm.trim() + '"';
      } else {
        var totalLive = allChannels.filter(function (c) { return !dead[c.id]; }).length;
        if (!channelsLoadComplete && totalLive === 0) statusEl.textContent = 'Carregando canais…';
        else statusEl.textContent = totalLive + ' canais ao vivo';
      }
    }
    if (!visibleChannels.length && channelsLoadComplete) emptyEl.classList.remove('hidden');
    else emptyEl.classList.add('hidden');
  }

  // ===== GRID VIRTUALIZADO (janela deslizante) =====
  // O MAIOR vilão do lag na TV: jogar 1200+ cards no DOM de uma vez. Isso pesa
  // de 3 formas — memória, layout/paint e, pior de tudo, o custo da NAVEGAÇÃO:
  // a cada toque de seta o sistema mede (getBoundingClientRect) TODOS os
  // focáveis pra achar o vizinho. 1200 medições por tecla = TV travando.
  //
  // Agora renderizamos só uma JANELA de linhas ao redor do card em foco (a
  // viewport + uma folga acima/abaixo). Dois "espaçadores" (topo e baixo)
  // seguram a altura total do scroll, então a barra de rolagem e as posições
  // continuam corretas como se tudo estivesse lá. O DOM fica com ~60 cards em
  // vez de 1200 — e a navegação volta a medir só esses ~60.
  //
  // Como a seleção/numeração/zapping usam o MODELO (array visibleChannels),
  // e não o DOM, nada disso quebra: só renderizamos menos.
  var GRID_COLS = 3;
  var GRID_ROW_H = 60;
  var GRID_GAP = 0;
  var GRID_BUFFER = 8;    // linhas extras renderizadas acima/abaixo da viewport
  var GRID_MARGIN = 4;    // re-janela quando o foco chega a <= N linhas da borda
  var gridViews = [];     // janelas ativas (1 por container renderizado)
  var rewindowing = false;

  function viewForCard(card) {
    for (var i = 0; i < gridViews.length; i++) {
      if (gridViews[i].el.contains(card)) return gridViews[i];
    }
    return null;
  }
  function viewportRows(view) {
    var h = view.el.clientHeight || 0;
    if (h < 50) return 10; // container ainda sem layout (splash) — chute seguro
    return Math.ceil(h / view.rowH);
  }

  function renderGrid(el, list) {
    if (!el) return;
    // remove a janela anterior desse mesmo container (nova busca/categoria)
    gridViews = gridViews.filter(function (v) { return v.el !== el; });
    el.innerHTML = '';
    el.scrollTop = 0;
    if (el === gridEl && channelScrollIndicatorEl) {
      if (channelScrollPickerOpen) closeChannelScrollPicker(false);
      channelScrollIndicatorEl.classList.remove('show');
      channelScrollLetterEl.disabled = true;
      channelScrollPickerEl.innerHTML = '';
    }
    if (!list.length) return;
    var view = {
      el: el, list: list, cols: GRID_COLS, rowH: GRID_ROW_H,
      totalRows: Math.ceil(list.length / GRID_COLS), scrollTimer: null,
      start: -1, end: -1
    };
    gridViews.push(view);
    if (!el._meflyGridScrollBound) {
      el.addEventListener('scroll', onGridScroll);
      el._meflyGridScrollBound = true;
    }
    renderWindow(view, 0);
    if (el === gridEl) updateChannelScrollIndicator(view, 0);
  }

  // Renderiza a janela [start, end) de LINHAS centrada em focusRow.
  function renderWindow(view, focusRow) {
    var cols = view.cols, rowH = view.rowH;
    var vr = viewportRows(view);
    var start = Math.max(0, focusRow - GRID_BUFFER);
    var end = Math.min(view.totalRows, focusRow + vr + GRID_BUFFER);
    if (start === view.start && end === view.end) return; // janela igual, nada a fazer
    view.start = start; view.end = end;

    var el = view.el;
    el.innerHTML = '';
    var frag = document.createDocumentFragment();

    // Espaçador de cima: empurra os cards pra posição real (rowH por linha,
    // menos 1 gap que o próprio grid já insere entre espaçador e 1ª linha).
    if (start > 0) {
      var top = document.createElement('div');
      top.style.cssText = 'grid-column:1 / -1;flex:0 0 auto;width:100%;height:' + Math.max(0, start * rowH - GRID_GAP) + 'px;';
      frag.appendChild(top);
    }

    var from = start * cols;
    var to = Math.min(view.list.length, end * cols);
    for (var i = from; i < to; i++) {
      var card = makeChannelCard(view.list[i], i);
      card.dataset.index = i;
      frag.appendChild(card);
    }

    if (end < view.totalRows) {
      var bottom = document.createElement('div');
      bottom.style.cssText = 'grid-column:1 / -1;flex:0 0 auto;width:100%;height:' + Math.max(0, (view.totalRows - end) * rowH - GRID_GAP) + 'px;';
      frag.appendChild(bottom);
    }

    el.appendChild(frag);
  }

  function channelInitial(name) {
    var letter = String(name || '').trim().charAt(0).toUpperCase();
    letter = letter.replace(/[À-Å]/g, 'A').replace(/Ç/g, 'C').replace(/[È-Ë]/g, 'E')
      .replace(/[Ì-Ï]/g, 'I').replace(/[Ò-Ö]/g, 'O').replace(/[Ù-Ü]/g, 'U');
    return /^[A-Z]$/.test(letter) ? letter : '#';
  }

  function mainGridView() {
    for (var i = 0; i < gridViews.length; i++) {
      if (gridViews[i].el === gridEl) return gridViews[i];
    }
    return null;
  }

  function closeChannelScrollPicker(restoreFocus) {
    if (!channelScrollPickerOpen) return;
    channelScrollPickerOpen = false;
    channelScrollPickerEl.classList.add('hidden');
    global.MeflyNav.popBackHandler();
    if (restoreFocus && !channelScrollLetterEl.disabled) global.MeflyNav.setFocus(channelScrollLetterEl);
  }

  function openChannelScrollPickerFromBack() { closeChannelScrollPicker(true); }

  function jumpToChannelIndex(view, index) {
    closeChannelScrollPicker(false);
    var row = Math.floor(index / view.cols);
    view.el.scrollTop = row * view.rowH;
    renderWindow(view, row);
    updateChannelScrollIndicator(view, index);
    var target = view.el.querySelector('[data-index="' + index + '"]');
    if (target) global.MeflyNav.setFocus(target);
  }

  function toggleChannelScrollPicker() {
    if (channelScrollPickerOpen) { closeChannelScrollPicker(true); return; }
    var view = mainGridView();
    if (!view || channelScrollLetterEl.disabled) return;
    channelScrollPickerEl.innerHTML = '';
    var seen = {};
    var firstButton = null;
    var selectedButton = null;
    for (var i = 0; i < view.list.length; i++) {
      var letter = channelInitial(view.list[i].name);
      if (Object.prototype.hasOwnProperty.call(seen, letter)) continue;
      seen[letter] = 1;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'channel-scroll-letter-option focusable' + (letter === channelScrollLetterEl.textContent ? ' current' : '');
      button.setAttribute('data-letter', letter);
      button.textContent = letter;
      button.onclick = (function (viewRef, indexRef) {
        return function () { jumpToChannelIndex(viewRef, indexRef); };
      })(view, i);
      if (!firstButton) firstButton = button;
      if (letter === channelScrollLetterEl.textContent) selectedButton = button;
      channelScrollPickerEl.appendChild(button);
    }
    if (!firstButton) return;
    channelScrollPickerOpen = true;
    channelScrollPickerEl.classList.remove('hidden');
    global.MeflyNav.pushBackHandler(openChannelScrollPickerFromBack);
    global.MeflyNav.setFocus(selectedButton || firstButton);
  }

  function updateChannelScrollIndicator(view, index) {
    if (!channelScrollIndicatorEl || view.el !== gridEl || !view.list.length) return;
    var trackHeight = channelScrollIndicatorEl.clientHeight;
    if (trackHeight < 50) return;
    var clientHeight = view.el.clientHeight;
    var scrollHeight = view.el.scrollHeight;
    if (scrollHeight <= clientHeight) {
      channelScrollIndicatorEl.classList.remove('show');
      channelScrollLetterEl.disabled = true;
      if (channelScrollPickerOpen) closeChannelScrollPicker(false);
      return;
    }

    var channelIndex = Math.max(0, Math.min(index, view.list.length - 1));
    channelScrollLetterEl.textContent = channelInitial(view.list[channelIndex].name);
    channelScrollLetterEl.disabled = false;

    var thumbHeight = Math.max(28, trackHeight * clientHeight / scrollHeight);
    var thumbRange = Math.max(0, trackHeight - thumbHeight);
    var scrollRange = Math.max(1, scrollHeight - clientHeight);
    var thumbTop = Math.round(thumbRange * view.el.scrollTop / scrollRange);
    channelScrollThumbEl.style.height = thumbHeight + 'px';
    channelScrollThumbEl.style.transform = 'translateY(' + thumbTop + 'px)';
    channelScrollLetterEl.style.top = Math.max(0, Math.min(trackHeight - 38, thumbTop + (thumbHeight - 38) / 2)) + 'px';
    channelScrollIndicatorEl.classList.add('show');
  }

  function onGridScroll(event) {
    if (rewindowing) return;
    var el = event.currentTarget;
    var view = null;
    for (var i = 0; i < gridViews.length; i++) {
      if (gridViews[i].el === el) { view = gridViews[i]; break; }
    }
    if (!view) return;
    var scrollRow = Math.floor(el.scrollTop / view.rowH);
    updateChannelScrollIndicator(view, scrollRow * view.cols);
    if (view.scrollTimer) return;
    view.scrollTimer = setTimeout(function () {
      view.scrollTimer = null;
      if (gridViews.indexOf(view) < 0) return;
      var firstRow = Math.floor(el.scrollTop / view.rowH);
      var rowsOnScreen = viewportRows(view);
      var nearTop = firstRow - view.start <= GRID_MARGIN && view.start > 0;
      var nearBottom = view.end - (firstRow + rowsOnScreen) <= GRID_MARGIN && view.end < view.totalRows;
      if (nearTop || nearBottom) {
        renderWindow(view, firstRow + Math.floor(rowsOnScreen / 2));
      }
    }, 40);
  }

  // Chamado quando o foco muda (MeflyNav.onFocusChange). Se o foco está num
  // card de grid e chegou perto da borda da janela renderizada, re-renderiza
  // a janela centrada no novo card — e reaplica o foco no mesmo índice (o card
  // antigo foi removido). Como a posição de cada linha é fixa (espaçadores),
  // não há "pulo" visual. Guard pra não recursar no próprio setFocus.
  function onGridFocus(el) {
    if (rewindowing) return;
    if (!el || !el.classList || !el.classList.contains('channel')) return;
    var view = viewForCard(el);
    if (!view) return;
    var idx = parseInt(el.dataset.index, 10);
    if (isNaN(idx)) return;
    var row = Math.floor(idx / view.cols);
    updateChannelScrollIndicator(view, idx);
    var nearTop = (row - view.start) <= GRID_MARGIN && view.start > 0;
    var nearBottom = (view.end - row) <= GRID_MARGIN && view.end < view.totalRows;
    if (!nearTop && !nearBottom) return;
    rewindowing = true;
    try {
      renderWindow(view, row);
      var again = view.el.querySelector('[data-index="' + idx + '"]');
      if (again) global.MeflyNav.setFocus(again);
    } finally {
      rewindowing = false;
    }
  }

  function displayName(raw) {
    return String(raw || '')
      .replace(/\(?\s*\d{3,4}\s*p\s*\)?/ig, '')
      .replace(/\b(fhd|uhd|hd|sd|4k)\b/ig, '')
      .replace(/\(\s*\)/g, '')
      .replace(/[\s\-_|.]+$/, '').replace(/^[\s\-_|.]+/, '')
      .replace(/\s{2,}/g, ' ').trim() || raw;
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

  function makeChannelCard(ch, index) {
    var row = document.createElement('button');
    row.className = 'channel focusable';
    row.setAttribute('data-id', ch.id);
    var number = document.createElement('span');
    number.className = 'channel-number';
    number.textContent = (index + 1) + '.';
    var name = document.createElement('span');
    name.className = 'channel-name';
    name.textContent = displayName(ch.name);
    row.appendChild(number);
    row.appendChild(name);
    row.onclick = function () {
      var view = viewForCard(row);
      openPlayer(ch, { channelList: view ? view.list : visibleChannels });
    };
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

  function isScheduledFootballChannel(channel) {
    var name = String(channel && channel.name || '');
    var group = String(channel && channel.group || '');
    var hasKickoffTime = /\b(?:[01]?\d|2[0-3])(?::|h)[0-5]\d\b/i.test(name);
    if (!hasKickoffTime) return false;
    var context = name + ' ' + group;
    var sportsContext = /\b(?:sports?|esportes?|futebol|football|soccer|premiere|libertadores|brasileir[aã]o|campeonato|copa|liga|champions)\b/i.test(context);
    var fixtureTitle = /\s+x\s+|\bvs\.?\s+|\bversus\b/i.test(name);
    return sportsContext || fixtureTitle;
  }

  function requestChannelPasscode(channel, options) {
    pendingProtectedChannel = channel;
    pendingProtectedOptions = options || {};
    protectedChannelReturnFocus = global.MeflyNav && global.MeflyNav.getFocus();
    channelPasscodeInputEl.value = '';
    channelPasscodeErrorEl.textContent = '';
    channelPasscodeErrorEl.classList.add('hidden');
    channelPasscodeModalEl.classList.remove('hidden');
    global.MeflyNav.pushBackHandler(cancelChannelPasscode);
    setTimeout(function () { global.MeflyNav.setFocus(channelPasscodeInputEl); }, 60);
  }

  function closeChannelPasscode(restoreFocus) {
    channelPasscodeModalEl.classList.add('hidden');
    global.MeflyNav.popBackHandler();
    channelPasscodeInputEl.value = '';
    channelPasscodeErrorEl.textContent = '';
    channelPasscodeErrorEl.classList.add('hidden');
    if (restoreFocus) {
      var previous = protectedChannelReturnFocus;
      setTimeout(function () {
        if (previous && document.body.contains(previous)) global.MeflyNav.setFocus(previous);
        else global.MeflyNav.focusFirst();
      }, 50);
    }
    protectedChannelReturnFocus = null;
  }

  function cancelChannelPasscode() {
    if (!channelPasscodeModalEl || channelPasscodeModalEl.classList.contains('hidden')) return;
    pendingProtectedChannel = null;
    pendingProtectedOptions = null;
    closeChannelPasscode(true);
  }

  function submitChannelPasscode() {
    if (!channelPasscodeModalEl || channelPasscodeModalEl.classList.contains('hidden')) return;
    if (channelPasscodeInputEl.value !== '0000') {
      channelPasscodeInputEl.value = '';
      channelPasscodeErrorEl.textContent = 'Senha incorreta.';
      channelPasscodeErrorEl.classList.remove('hidden');
      global.MeflyNav.setFocus(channelPasscodeInputEl);
      return;
    }

    var channel = pendingProtectedChannel;
    var options = {};
    for (var key in pendingProtectedOptions) {
      if (Object.prototype.hasOwnProperty.call(pendingProtectedOptions, key)) options[key] = pendingProtectedOptions[key];
    }
    options.passcodeVerified = true;
    pendingProtectedChannel = null;
    pendingProtectedOptions = null;
    closeChannelPasscode(false);
    if (channel) openPlayer(channel, options);
  }

  // ===== TEMPO DE EXIBIÇÃO ("Mais assistidos") =====
  // Conta quanto tempo o canal fica REALMENTE tocando (a partir do onPlaying).
  // A cada 30s grava o parcial no storage (sobrevive a desligar a TV) e, ao
  // trocar/fechar, fecha a conta. 10min acumulados → entra em "Mais assistidos".
  var watch = { ch: null, startTs: 0, timer: null };
  function flushWatch(keepGoing) {
    if (watch.ch && watch.startTs) {
      var ms = Date.now() - watch.startTs;
      if (ms > 1000) { try { global.MeflyStorage.addWatch(watch.ch, ms); } catch (_) {} }
      watch.startTs = keepGoing ? Date.now() : 0;
    }
    if (!keepGoing) {
      if (watch.timer) { clearInterval(watch.timer); watch.timer = null; }
      watch.ch = null;
    }
  }
  function beginWatch(ch) {
    if (!ch) return;
    if (watch.ch && watch.ch.id === ch.id && watch.startTs) return; // já contando este
    flushWatch(); // fecha a conta do anterior, se houver
    watch.ch = ch; watch.startTs = Date.now();
    if (watch.timer) clearInterval(watch.timer);
    watch.timer = setInterval(function () { flushWatch(true); }, 30000);
  }

  // ===== PLAYER =====
  // opts.isSwap=true → não recria a sessão de tentativa, só toca o próximo da fila
  function openPlayer(ch, opts) {
    opts = opts || {};
    if (!opts.passcodeVerified && global.MeflyStorage.requiresChannelPasscode(ch) && !isScheduledFootballChannel(ch)) {
      requestChannelPasscode(ch, opts);
      return;
    }
    // Vai trocar de canal: fecha a conta de exibição do que estava tocando.
    if (watch.ch && (!ch || watch.ch.id !== ch.id)) flushWatch();
    var isFirstAttempt = !opts.isSwap;
    var alreadyOpen = !playerEl.classList.contains('hidden');
    if (opts.channelList) playerChannelList = opts.channelList.slice();
    else if (!alreadyOpen && !opts.isSwap) playerChannelList = visibleChannels.slice();

    if (isFirstAttempt) {
      // Usuário pediu ESTE canal — reinicia o histórico de twins.
      var twins = findTwins(ch).filter(function (t) { return !dead[t.id]; });
      swapSession = { requestedId: ch.id, requestedName: ch.name, queue: twins, attempt: 0 };
      // Guarda o anterior pro "canal flip" (AZUL no LG). Só em troca explícita
      // do usuário — swaps por falha de stream NÃO viram o "anterior".
      if (currentChannel && currentChannel.id !== ch.id) lastChannel = currentChannel;
    }

    currentChannel = ch;
    if (playerListVisible) updatePlayerListCurrent();
    playerEl.classList.remove('hidden');
    document.body.classList.add('player-open');
    errorOverlay.classList.add('hidden');
    loadingOverlay.classList.remove('hidden');
    showOSD();
    setPlayerLogo(ch);
    loadingTextEl.textContent = 'Carregando…';

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

    global.MeflyAddons.resolveStream(ch).catch(function (error) {
      var message = String(error && error.message || '');
      if (/sem stream tocável|addon desconhecido/i.test(message)) throw error;
      return new Promise(function (resolve) { setTimeout(resolve, 1200); })
        .then(function () { return global.MeflyAddons.resolveStream(ch); });
    }).then(function (url) {
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
          beginWatch(ch); // começa/retoma a contagem de tempo assistido
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
    flushWatch(); // fecha a conta de exibição do canal que estava tocando
    global.MeflyPlayer.stop();
    playerEl.classList.add('hidden');
    document.body.classList.remove('player-open');
    playerListEl.classList.add('hidden');
    playerListVisible = false;
    swapSession = null;
    global.MeflyNav.popBackHandler();
    global.MeflyNav.removeKeyHandler(playerKeyHandler);
    currentChannel = null;
    // O canal recém-visto pode ter entrado/subido em "Mais assistidos":
    // reconstrói os chips e a grade pra refletir (mais recente vai pro topo).
    try { renderGroups(); applyFilter(); } catch (_) {}
    setTimeout(function () { global.MeflyNav.focusFirst(); }, 50);
  }

  function showOSD() {
    if (!currentChannel) return;
    var idx = playerChannelList.findIndex(function (c) { return c.id === currentChannel.id; });
    var num = idx >= 0 ? String(idx + 1).padStart(3, '0') : '—';
    osdNumberEl.textContent = num;
    var quality = Number(currentChannel.quality) || 0;
    if (!quality) {
      var qualityMatch = String(currentChannel.name || '').match(/\b(2160|1440|1080|720|576|480)p?\b/i);
      if (qualityMatch) quality = Number(qualityMatch[1]);
      else if (/\b(4k|uhd)\b/i.test(currentChannel.name || '')) quality = 2160;
      else if (/\bfhd\b/i.test(currentChannel.name || '')) quality = 1080;
      else if (/\bhd\b/i.test(currentChannel.name || '')) quality = 720;
    }
    var qualityLabel = quality >= 2160 ? '4K' : (quality >= 1080 ? '1080p' : (quality >= 720 ? '720p' : ''));
    var channelLabel = displayName(currentChannel.name) + (qualityLabel ? ' (' + qualityLabel + ')' : '');
    osdNameTextEl.textContent = channelLabel;
    osdNameCopyEl.textContent = channelLabel;
    osdNameEl.classList.remove('scrolling');
    osdNameEl.style.removeProperty('--osd-marquee-duration');
    var osdDuration = 15000;
    if (osdNameTextEl.scrollWidth > osdNameEl.clientWidth + 4) {
      var marqueeSeconds = Math.max(10, (osdNameTextEl.scrollWidth + 80) / 44);
      osdNameEl.style.setProperty('--osd-marquee-duration', marqueeSeconds + 's');
      osdNameEl.classList.add('scrolling');
      osdDuration = Math.max(osdDuration, (marqueeSeconds + 3) * 1000);
    }
    setLogo(osdLogoEl, currentChannel.logo);
    osdGroupEl.textContent = CAT_LABEL[classifyChannel(currentChannel)] || (currentChannel.group || '—');
    if (osdFavEl) {
      if (global.MeflyStorage.isFavorite(currentChannel.id)) osdFavEl.classList.remove('hidden');
      else osdFavEl.classList.add('hidden');
    }
    osdEl.classList.add('show');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () { osdEl.classList.remove('show'); }, osdDuration);

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
    if (!playerChannelList.length || !currentChannel) return;
    var idx = playerChannelList.findIndex(function (c) { return c.id === currentChannel.id; });
    if (idx < 0) idx = 0;
    var next = playerChannelList[(idx + delta + playerChannelList.length) % playerChannelList.length];
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
    if (playerListVisible) return;
    playerListVisible = true;
    renderPlayerList();
    playerListEl.classList.remove('hidden');
    focusPlayerListItem(currentChannel && currentChannel.id);
  }

  function closePlayerList() {
    if (!playerListVisible) return;
    playerListVisible = false;
    playerListEl.classList.add('hidden');
  }

  function focusPlayerListItem(id) {
    var items = playerListBodyEl.querySelectorAll('.player-list-item');
    var fallback = null;
    for (var i = 0; i < items.length; i++) {
      if (!fallback) fallback = items[i];
      if (id && items[i].getAttribute('data-channel-id') === String(id)) {
        global.MeflyNav.setFocus(items[i]);
        return;
      }
    }
    if (fallback) global.MeflyNav.setFocus(fallback);
  }

  function updatePlayerListCurrent() {
    if (!playerListVisible || !playerListBodyEl) return;
    var items = playerListBodyEl.querySelectorAll('.player-list-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('current', !!currentChannel &&
        items[i].getAttribute('data-channel-id') === String(currentChannel.id));
    }
  }

  var plRenderToken = 0;
  function renderPlayerList() {
    playerListBodyEl.innerHTML = '';
    var token = ++plRenderToken;
    var max = Math.min(playerChannelList.length, 5000);
    var currentIndex = playerChannelList.findIndex(function (channel) {
      return currentChannel && channel.id === currentChannel.id;
    });
    var startIndex = currentIndex >= 0
      ? (currentIndex - Math.min(8, max - 1) + playerChannelList.length) % playerChannelList.length
      : 0;
    var displayList = [];
    for (var offset = 0; offset < max; offset++) {
      var sourceIndex = (startIndex + offset) % playerChannelList.length;
      displayList.push({ channel: playerChannelList[sourceIndex], number: sourceIndex + 1 });
    }
    var i = 0, BATCH = 40;
    function buildOne(entry) {
      var ch = entry.channel;
      var btn = document.createElement('button');
      btn.className = 'player-list-item focusable' + (currentChannel && ch.id === currentChannel.id ? ' current' : '');
      btn.setAttribute('data-channel-id', ch.id);
      var number = document.createElement('span');
      number.className = 'number';
      number.textContent = entry.number + '.';
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = displayName(ch.name);
      btn.appendChild(number);
      btn.appendChild(name);
      btn.onclick = (function (chRef) {
        return function () {
          if (currentChannel && currentChannel.id === chRef.id) {
            closePlayerList();
            return;
          }
          openPlayer(chRef, { channelList: playerChannelList });
        };
      })(ch);
      return btn;
    }
    // Lote inicial síncrono
    var frag = document.createDocumentFragment();
    var n1 = Math.min(BATCH, max);
    for (; i < n1; i++) frag.appendChild(buildOne(displayList[i]));
    playerListBodyEl.appendChild(frag);
    function tick() {
      if (token !== plRenderToken) return;
      var f = document.createDocumentFragment();
      var end = Math.min(i + BATCH, max);
      for (; i < end; i++) f.appendChild(buildOne(displayList[i]));
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
    var idx = Math.min(n, playerChannelList.length) - 1;
    var target = playerChannelList[idx];
    if (target) openPlayer(target);
  }
  function cancelNumEntry() {
    clearTimeout(numEntryTimer);
    numEntry = '';
    if (numEntryEl) numEntryEl.classList.remove('show');
  }

  function playerKeyHandler(e, k) {
    if (playerEl.classList.contains('hidden')) return false;
    if (channelPasscodeModalEl && !channelPasscodeModalEl.classList.contains('hidden')) return false;
    var KEY = global.MeflyNav.KEY;

    var digit = -1;
    if (k >= 48 && k <= 57) digit = k - 48;
    else if (k >= 96 && k <= 105) digit = k - 96;
    if (digit >= 0) {
      pushDigit(String(digit));
      return true;
    }

    if (playerListVisible && (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE)) {
      cancelNumEntry();
      closePlayerList();
      return true;
    }

    if (numEntry) {
      if (k === KEY.OK || k === KEY.ENTER) { commitNumEntry(); return true; }
      if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) { cancelNumEntry(); return true; }
    }

    if ((k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) && osdEl.classList.contains('show')) {
      clearTimeout(osdTimer);
      osdEl.classList.remove('show');
      return true;
    }

    if (playerListVisible) {
      return false;
    }

    // ===== Atalhos do D-pad — funcionam em QUALQUER controle =====
    // Pensado especialmente pros controles Android TV/TCL, que NÃO têm botões
    // coloridos nem teclado numérico. ◀ favorita, ▶ abre a lista de canais.
    if (k === KEY.LEFT) { toggleFavoriteCurrent(); return true; }
    if (k === KEY.RIGHT) { togglePlayerList(); return true; }

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
    // OK sem o painel aberto mostra as informações do canal.
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
    var storedFavorites = global.MeflyStorage.loadFavorites();
    var channelsById = {};
    for (var i = 0; i < allChannels.length; i++) channelsById[allChannels[i].id] = allChannels[i];
    var favs = storedFavorites.map(function (channel) { return channelsById[channel.id] || channel; });
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
    // Mantido para compatibilidade com main.js; a tela Esportes não captura frames.
  }

  function hasDevAccess() {
    return global.MeflyDevAccess === true && location.port === '8088' &&
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  }

  function getChannelForDev(id) {
    if (!hasDevAccess()) return null;
    for (var i = 0; i < allChannels.length; i++) {
      if (String(allChannels[i].id) === String(id)) return allChannels[i];
    }
    return null;
  }

  function openChannelForDev(channel, channelList) {
    if (!hasDevAccess() || !channel) return false;
    openPlayer(channel, { channelList: channelList && channelList.length ? channelList : [channel] });
    return true;
  }

  function getCurrentChannelForDev() {
    if (!hasDevAccess() || !playerEl || playerEl.classList.contains('hidden')) return null;
    return currentChannel;
  }

  function closePlayerForDev() {
    if (!hasDevAccess() || !playerEl || playerEl.classList.contains('hidden')) return false;
    closePlayer();
    return true;
  }

  function isSportsChannelForDev(channel) {
    if (!hasDevAccess() || !channel) return false;
    return isBrazilianSportsChannel(channel);
  }

  function prepareHiddenGridForDev() {
    if (!hasDevAccess()) return false;
    renderGrid(gridEl, []);
    return true;
  }

  function refreshChannelsForDev() {
    if (!hasDevAccess()) return false;
    allChannels = allChannels.filter(function (channel) { return !global.MeflyStorage.isBlockedChannel(channel); });
    renderGroups();
    renderLive();
    applyFilter();
    return true;
  }

  function restoreChannelForDev(channel) {
    if (!hasDevAccess() || !channel || global.MeflyStorage.isBlockedChannel(channel)) return false;
    var found = false;
    for (var i = 0; i < allChannels.length; i++) {
      if (String(allChannels[i].id) === String(channel.id)) { found = true; break; }
    }
    if (!found) allChannels.push(channel);
    renderGroups();
    renderLive();
    applyFilter();
    return true;
  }

  global.MeflyUIChannels = {
    init: init,
    load: load,
    renderChannels: renderChannels,
    renderFavorites: renderFavorites,
    renderLive: renderLive,
    stopBgCapture: stopBgCapture,
    getChannelForDev: getChannelForDev,
    openChannelForDev: openChannelForDev,
    getCurrentChannelForDev: getCurrentChannelForDev,
    closePlayerForDev: closePlayerForDev,
    isSportsChannelForDev: isSportsChannelForDev,
    prepareHiddenGridForDev: prepareHiddenGridForDev,
    refreshChannelsForDev: refreshChannelsForDev,
    restoreChannelForDev: restoreChannelForDev
  };
})(window);

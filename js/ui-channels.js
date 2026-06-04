/**
 * ui-channels.js — Tela de "Canais de TV".
 * Renderiza grid + filtros de grupo. Cuida do player também (overlay).
 */
(function (global) {
  'use strict';

  var allChannels = [];
  var visibleChannels = [];
  var currentGroup = 'Todos';
  var searchTerm = '';
  var searchTimer = null;
  var dead = {};
  var placeholderLogos = {}; // URLs de logo que sao "sem imagem" genericas (repetidas demais)
  var groupsEl, gridEl, emptyEl, statusEl, searchInputEl;

  // ===== PLAYER STATE =====
  var playerEl, videoEl, osdEl, osdNumberEl, osdNameEl, osdLogoEl, osdGroupEl, osdClockEl, osdFavEl;
  var loadingOverlay, errorOverlay, errorTitleEl, errorTextEl, loadingTextEl, loadingLogoEl, playerLogoEl;
  var playerListEl, playerListBodyEl, playerHintEl;
  var currentChannel = null;
  var playerListVisible = false;
  var osdTimer = null;
  var hintTimer = null;
  // Digitação de número de canal pelo controle
  var numEntry = '';
  var numEntryTimer = null;
  var numEntryEl = null;
  var numDigitsEl = null;

  function init() {
    groupsEl = document.getElementById('groups');
    gridEl = document.getElementById('channels-grid');
    emptyEl = document.getElementById('channels-empty');
    statusEl = document.getElementById('channels-status');
    searchInputEl = document.getElementById('search-input');
    if (searchInputEl) {
      searchInputEl.addEventListener('input', function () {
        searchTerm = searchInputEl.value || '';
        // debounce leve pra não re-renderizar a cada tecla (TV é lenta)
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
    playerLogoEl = loadingLogoEl;
    playerListEl = document.getElementById('player-list');
    playerListBodyEl = document.getElementById('player-list-body');
    playerHintEl = document.getElementById('player-hint');
    numEntryEl = document.getElementById('ch-num-entry');
    numDigitsEl = document.getElementById('cne-digits');
  }

  function load(onDone) {
    statusEl.textContent = 'Carregando canais…';
    gridEl.innerHTML = '';
    emptyEl.classList.add('hidden');

    var addons = global.MeflyStorage.loadAddons();
    dead = global.MeflyStorage.loadDead();

    global.MeflyChannels.loadAll(addons).then(function (result) {
      allChannels = result.channels || [];
      detectPlaceholderLogos();
      // Restaura a última categoria escolhida (se ainda existir nos canais atuais)
      try {
        var saved = localStorage.getItem('mefly_tv_last_group');
        if (saved && (saved === 'Todos' || saved === 'Principais' ||
            allChannels.some(function (c) { return String(c.group || '').trim() === saved; }))) {
          currentGroup = saved;
        }
      } catch (_) {}
      renderGroups();
      applyFilter();
      var count = visibleChannels.length;
      if (count === 0) {
        statusEl.textContent = 'Nenhum canal disponível';
        emptyEl.classList.remove('hidden');
      } else {
        statusEl.textContent = count + ' canais ao vivo';
      }
      // Refoca após render
      setTimeout(function () { global.MeflyNav.focusFirst(); }, 100);
      if (typeof onDone === 'function') onDone();
    }).catch(function (e) {
      statusEl.textContent = 'Erro ao carregar canais';
      emptyEl.classList.remove('hidden');
      console.error('[channels load]', e);
      if (typeof onDone === 'function') onDone();
    });
  }

  /**
   * Detecta logos "placeholder": quando o MESMO arquivo de imagem se repete em
   * dezenas de canais, é a imagem genérica de "sem logo" do addon. Nesses casos
   * fica mais limpo mostrar o ícone 📺 do que o quadrado genérico repetido.
   */
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

  // Observer pra carregar logos só quando o card aparece na tela (lazy-load).
  // Essencial pra TV: evita baixar/decodificar centenas de imagens de uma vez.
  var logoObserver = null;
  function getLogoObserver() {
    if (logoObserver || typeof IntersectionObserver === 'undefined') return logoObserver;
    logoObserver = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          var el = entries[i].target;
          logoObserver.unobserve(el);
          loadLogoNow(el, el.getAttribute('data-logo'));
        }
      }
    }, { rootMargin: '300px' }); // começa a carregar um pouco antes de aparecer
    return logoObserver;
  }

  /**
   * Carrega a logo do canal. Pré-carrega em memória (não trava a tela) e só
   * mostra quando vem inteira. Como a lista BR é enxuta (~200-300 canais), é
   * mais confiável carregar direto do que depender de IntersectionObserver
   * (que se mostrou instável em alguns ambientes de TV).
   */
  function attachLogo(thumbEl, src) {
    if (!src) return;
    if (placeholderLogos[src]) return; // logo generica "sem imagem" -> deixa o monograma
    loadLogoNow(thumbEl, src);
  }

  /**
   * Carrega a logo de fato: pré-carrega em memória e só anexa o <img>
   * quando vem 100% decodificada. Se falhar, mantém o emoji 📺.
   */
  function loadLogoNow(thumbEl, src) {
    if (!src) return;
    var pre = new Image();
    pre.onload = function () {
      if (pre.naturalWidth < 8 || pre.naturalHeight < 8) return; // ignora 1x1
      // Logo real chegou: tira o monograma (cor + letra) pra não vazar atrás.
      thumbEl.classList.remove('is-mono');
      thumbEl.classList.add('has-logo');
      thumbEl.style.background = '';
      var img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.src = src;
      img.style.opacity = '0';
      img.style.transition = 'opacity 0.25s ease';
      thumbEl.appendChild(img);
      requestAnimationFrame(function () { img.style.opacity = '1'; });
    };
    pre.onerror = function () { /* mantém o monograma */ };
    pre.src = src;
  }

  function renderGroups() {
    var count = {};
    for (var i = 0; i < allChannels.length; i++) {
      var g = String(allChannels[i].group || '').trim();
      if (g) count[g] = (count[g] || 0) + 1;
    }
    var top = Object.keys(count)
      .filter(function (g) { return count[g] >= 3; })
      .sort(function (a, b) { return count[b] - count[a]; })
      .slice(0, 40);

    groupsEl.innerHTML = '';
    var live = allChannels.filter(function (c) { return !dead[c.id]; });
    var totalLive = live.length;
    var mainCount = live.filter(isMainChannel).length;
    // "Todos" e "Principais" pinados no topo; depois as categorias por volume.
    var groups = [{ name: 'Todos', n: totalLive }];
    if (mainCount > 0) groups.push({ name: 'Principais', n: mainCount });
    groups = groups.concat(top.map(function (g) { return { name: g, n: count[g] }; }));
    for (var j = 0; j < groups.length; j++) {
      groupsEl.appendChild(makeCatChip(groups[j]));
    }
  }

  function makeCatChip(g) {
    var btn = document.createElement('button');
    btn.className = 'cat-chip focusable' + (g.name === currentGroup ? ' selected' : '');
    var nm = document.createElement('span');
    nm.className = 'cat-name';
    nm.textContent = g.name;
    var ct = document.createElement('span');
    ct.className = 'cat-count';
    ct.textContent = g.n;
    btn.appendChild(nm);
    btn.appendChild(ct);
    btn.onclick = function () {
      currentGroup = g.name;
      try { localStorage.setItem('mefly_tv_last_group', g.name); } catch (_) {}
      // Limpa busca ao trocar de categoria
      if (searchInputEl && searchInputEl.value) { searchInputEl.value = ''; searchTerm = ''; }
      // Atualiza só o estado "selected" (sem re-render que perde o foco)
      var chips = groupsEl.querySelectorAll('.cat-chip');
      for (var k = 0; k < chips.length; k++) chips[k].classList.remove('selected');
      btn.classList.add('selected');
      applyFilter();
    };
    return btn;
  }

  // "Principais": canais da TV aberta brasileira (Globo, SBT, Record, Band…).
  // Regex no nome do canal. Pinada no topo das categorias.
  var MAIN_RE = /\b(globo|gnt|globonews|sbt|record(\s|news|tv)|band(\s|news|sports|eirantes)?|rede ?tv|cultura|cnn brasil|jovem pan|tv brasil|sportv|premiere|espn|cazé|tnt|telecine|warner|discovery|hbo|megapix|multishow|gloob|cartoon|disney|nickelodeon|viva|canal brasil)\b/i;
  function isMainChannel(c) {
    return MAIN_RE.test(String(c.name || ''));
  }

  function applyFilter() {
    var q = searchTerm.trim().toLowerCase();
    visibleChannels = allChannels.filter(function (c) {
      if (dead[c.id]) return false;
      // Busca tem prioridade: ignora categoria e procura no nome todo.
      if (q) return String(c.name || '').toLowerCase().indexOf(q) >= 0;
      if (currentGroup === 'Principais') return isMainChannel(c);
      if (currentGroup !== 'Todos' && String(c.group || '').trim() !== currentGroup) return false;
      return true;
    });
    renderGrid();
    // Atualiza o status com a contagem da busca
    if (q && statusEl) {
      statusEl.textContent = visibleChannels.length + ' resultado(s) para "' + searchTerm.trim() + '"';
    }
  }

  function renderGrid() {
    gridEl.innerHTML = '';
    if (!visibleChannels.length) {
      emptyEl.classList.remove('hidden');
      return;
    }
    emptyEl.classList.add('hidden');

    // Com lazy-load de logos, o gargalo agora é só o nº de divs.
    // Aumentamos o limite para comportar canais extras do addon.
    var max = Math.min(visibleChannels.length, 5000);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < max; i++) {
      frag.appendChild(makeChannelCard(visibleChannels[i]));
    }
    gridEl.appendChild(frag);
  }

  // Fallback sem logo: inicial discreta em fundo neutro (estilo monocromático,
  // elegante). A cor/aparência vem do CSS (.is-mono) — sem cores vibrantes.
  function fillMonogram(thumbEl, name) {
    var letter = (name || '?').trim().charAt(0).toUpperCase() || '?';
    thumbEl.classList.add('is-mono');
    var span = document.createElement('span');
    span.className = 'mono-letter';
    span.textContent = letter;
    thumbEl.appendChild(span);
  }

  // Nome limpo pra exibir: sem "(1080p)", "FHD" etc. (a qualidade vira selo).
  function displayName(raw) {
    return String(raw || '')
      .replace(/\(?\s*\d{3,4}\s*p\s*\)?/ig, '')
      .replace(/\b(fhd|uhd|hd|sd|4k)\b/ig, '')
      .replace(/\(\s*\)/g, '')
      .replace(/[\s\-_|.]+$/, '').replace(/^[\s\-_|.]+/, '')
      .replace(/\s{2,}/g, ' ').trim() || raw;
  }
  // Selo de qualidade (só pra HD+; SD não ganha selo pra não poluir).
  function qualityBadge(q) {
    if (q >= 2160) return '4K';
    if (q >= 1080) return 'FHD';
    if (q >= 720) return 'HD';
    return '';
  }

  function makeChannelCard(ch) {
    var row = document.createElement('button');
    row.className = 'channel focusable';
    row.setAttribute('data-id', ch.id);

    var thumb = document.createElement('div');
    thumb.className = 'channel-thumb';
    fillMonogram(thumb, displayName(ch.name));
    attachLogo(thumb, ch.logo);

    var name = document.createElement('div');
    name.className = 'channel-name';
    name.textContent = displayName(ch.name);

    row.appendChild(thumb);
    row.appendChild(name);

    var badge = qualityBadge(ch.quality || 0);
    if (badge) {
      var b = document.createElement('span');
      b.className = 'q-badge';
      b.textContent = badge;
      row.appendChild(b);
    }

    // Nome grande: quando o card é focado, o texto "passa" (marquee) dentro do
    // próprio card — sem crescer o balão. Cards continuam todos do mesmo tamanho.
    row.addEventListener('focus', function () {
      var over = name.scrollWidth - name.clientWidth;
      if (over > 6) {
        name.style.setProperty('--mq', '-' + (over + 10) + 'px');
        row.classList.add('marquee');
      }
    });
    row.addEventListener('blur', function () {
      row.classList.remove('marquee');
      name.style.removeProperty('--mq');
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

    // Empurra handler de "voltar" — sair do player
    global.MeflyNav.pushBackHandler(closePlayer);
    // Adiciona handler de teclas específicas do player
    global.MeflyNav.addKeyHandler(playerKeyHandler);

    // Resolve o stream e toca
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
    // Refoca no grid
    setTimeout(function () { global.MeflyNav.focusFirst(); }, 50);
  }

  function showOSD() {
    if (!currentChannel) return;
    var idx = visibleChannels.findIndex(function (c) { return c.id === currentChannel.id; });
    var num = idx >= 0 ? String(idx + 1).padStart(3, '0') : '—';
    osdNumberEl.textContent = num;
    osdNameEl.textContent = currentChannel.name;
    setLogo(osdLogoEl, currentChannel.logo);
    osdGroupEl.textContent = currentChannel.group || '—';
    osdClockEl.textContent = nowHHMM();
    // Coração se o canal atual for favorito
    if (osdFavEl) {
      if (global.MeflyStorage.isFavorite(currentChannel.id)) osdFavEl.classList.remove('hidden');
      else osdFavEl.classList.add('hidden');
    }
    osdEl.classList.add('show');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () { osdEl.classList.remove('show'); }, 5000);

    // Dica de teclas
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
    // Esconde primeiro; só revela se a imagem carregar 100% (sem quebrado).
    imgEl.removeAttribute('src');
    imgEl.style.display = 'none';
    if (!src || placeholderLogos[src]) return;
    var pre = new Image();
    pre.onload = function () {
      if (pre.naturalWidth < 8 || pre.naturalHeight < 8) return;
      imgEl.src = src;
      imgEl.style.display = '';
    };
    pre.onerror = function () { /* mantém escondido */ };
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
      // Foca o primeiro item da lista
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
      fillMonogram(thumb, ch.name);
      attachLogo(thumb, ch.logo);
      var name = document.createElement('span'); name.className = 'name'; name.textContent = ch.name;
      btn.appendChild(thumb); btn.appendChild(name);
      (function (chRef) { btn.onclick = function () { togglePlayerList(); openPlayer(chRef); }; })(ch);
      frag.appendChild(btn);
    }
    playerListBodyEl.appendChild(frag);
  }

  // ===== DIGITAÇÃO DE NÚMERO DE CANAL (controle remoto) =====
  // Acumula dígitos, mostra o visor e, após uma pausa (ou OK), pula pro canal.
  function pushDigit(d) {
    numEntry += d;
    if (numEntry.length > 4) numEntry = numEntry.slice(-4); // máx 4 dígitos
    if (numDigitsEl) numDigitsEl.textContent = numEntry;
    if (numEntryEl) numEntryEl.classList.add('show');
    // Enquanto digita, esconde a lista/OSD pra não poluir
    clearTimeout(numEntryTimer);
    numEntryTimer = setTimeout(commitNumEntry, 2000); // 2s sem digitar = confirma
  }

  function commitNumEntry() {
    clearTimeout(numEntryTimer);
    var n = parseInt(numEntry, 10);
    numEntry = '';
    if (numEntryEl) numEntryEl.classList.remove('show');
    if (!n || n < 1) return;
    // Canal por POSIÇÃO na lista visível (1 = primeiro). É o que o usuário espera
    // quando o OSD mostra "001, 002…". Se passar do total, vai pro último.
    var idx = Math.min(n, visibleChannels.length) - 1;
    var target = visibleChannels[idx];
    if (target) openPlayer(target);
  }

  function cancelNumEntry() {
    clearTimeout(numEntryTimer);
    numEntry = '';
    if (numEntryEl) numEntryEl.classList.remove('show');
  }

  // Handler de teclas EXTRAS dentro do player (D-pad cima/baixo troca de canal)
  function playerKeyHandler(e, k) {
    if (playerEl.classList.contains('hidden')) return false;
    var KEY = global.MeflyNav.KEY;

    // Dígitos 0-9 (linha de cima 48-57 e teclado numérico 96-105) → digita canal.
    var digit = -1;
    if (k >= 48 && k <= 57) digit = k - 48;
    else if (k >= 96 && k <= 105) digit = k - 96;
    if (digit >= 0) {
      // Se a lista estiver aberta, fecha pra mostrar o visor de número
      if (playerListVisible) togglePlayerList();
      pushDigit(String(digit));
      return true;
    }

    // Se está digitando número, OK confirma na hora e ↑↓ também confirmam antes de zapear
    if (numEntry) {
      if (k === KEY.OK || k === KEY.ENTER) { commitNumEntry(); return true; }
      if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) { cancelNumEntry(); return true; }
    }

    if (playerListVisible) {
      // Quando a lista está aberta, deixa a navegação normal funcionar.
      // Só o BACK fecha a lista (sem fechar o player).
      if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) {
        togglePlayerList();
        return true;
      }
      return false;
    }

    // FAVORITAR: botão Verde (confiável em todo controle LG) + candidatos do
    // botão AD/SAP (varia por modelo de controle — cobrimos os códigos comuns).
    if (k === KEY.GREEN || isFavKey(k)) { toggleFavoriteCurrent(); return true; }

    // Sem lista aberta: ↑↓ troca canal, OK abre lista, CH+/CH- também troca
    if (k === KEY.UP || k === KEY.CHUP) { zap(-1); showOSD(); return true; }
    if (k === KEY.DOWN || k === KEY.CHDOWN) { zap(1); showOSD(); return true; }
    if (k === KEY.OK) { togglePlayerList(); return true; }
    if (k === KEY.PLAY) {
      try { videoEl.play(); } catch (_) {}
      return true;
    }
    if (k === KEY.PAUSE) {
      try { videoEl.pause(); } catch (_) {}
      return true;
    }
    return false;
  }

  // Códigos candidatos do botão AD/SAP (descrição de áudio) em controles LG.
  // Não há um código único oficial, então cobrimos os relatados.
  function isFavKey(k) {
    return k === 417 || k === 10252 || k === 502 || k === 2071 || k === 1052;
  }

  function toggleFavoriteCurrent() {
    if (!currentChannel) return;
    var nowFav = global.MeflyStorage.toggleFavorite(currentChannel);
    showFavFeedback(nowFav);
    showOSD(); // atualiza o coração no OSD
  }

  function showFavFeedback(isFav) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.className = 'toast ' + (isFav ? 'success' : '');
    el.innerHTML = (isFav ? '❤️ Adicionado aos Favoritos' : '🤍 Removido dos Favoritos');
    el.classList.remove('hidden');
    clearTimeout(favToastTimer);
    favToastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2200);
  }
  var favToastTimer = null;

  // ===== TELA DE FAVORITOS =====
  function renderFavorites() {
    var grid = document.getElementById('favorites-grid');
    var empty = document.getElementById('favorites-empty');
    var status = document.getElementById('favorites-status');
    if (!grid) return;
    var favs = global.MeflyStorage.loadFavorites();
    grid.innerHTML = '';
    if (!favs.length) {
      empty.classList.remove('hidden');
      status.textContent = 'Nenhum favorito ainda';
      return;
    }
    empty.classList.add('hidden');
    status.textContent = favs.length + (favs.length === 1 ? ' canal favorito' : ' canais favoritos');
    var frag = document.createDocumentFragment();
    for (var i = 0; i < favs.length; i++) {
      // Reusa o mesmo card; ao abrir, garante a lista de zapping = favoritos
      (function (favCh) {
        var card = makeChannelCard(favCh);
        frag.appendChild(card);
      })(favs[i]);
    }
    grid.appendChild(frag);
  }

  global.MeflyUIChannels = {
    init: init,
    load: load,
    renderFavorites: renderFavorites
  };
})(window);

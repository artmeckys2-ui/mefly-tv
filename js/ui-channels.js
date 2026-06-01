/**
 * ui-channels.js — Tela de "Canais de TV".
 * Renderiza grid + filtros de grupo. Cuida do player também (overlay).
 */
(function (global) {
  'use strict';

  var allChannels = [];
  var visibleChannels = [];
  var currentGroup = 'Todos';
  var dead = {};
  var groupsEl, gridEl, emptyEl, statusEl;

  // ===== PLAYER STATE =====
  var playerEl, videoEl, osdEl, osdNumberEl, osdNameEl, osdLogoEl, osdGroupEl, osdClockEl;
  var loadingOverlay, errorOverlay, errorTitleEl, errorTextEl, loadingTextEl, loadingLogoEl, playerLogoEl;
  var playerListEl, playerListBodyEl, playerHintEl;
  var currentChannel = null;
  var playerListVisible = false;
  var osdTimer = null;
  var hintTimer = null;

  function init() {
    groupsEl = document.getElementById('groups');
    gridEl = document.getElementById('channels-grid');
    emptyEl = document.getElementById('channels-empty');
    statusEl = document.getElementById('channels-status');

    playerEl = document.getElementById('player');
    videoEl = document.getElementById('video');
    osdEl = document.getElementById('osd');
    osdNumberEl = document.getElementById('osd-number');
    osdNameEl = document.getElementById('osd-name');
    osdLogoEl = document.getElementById('osd-logo');
    osdGroupEl = document.getElementById('osd-group');
    osdClockEl = document.getElementById('osd-clock');
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
  }

  function load() {
    statusEl.textContent = 'Carregando canais…';
    gridEl.innerHTML = '';
    emptyEl.classList.add('hidden');

    var addons = global.MeflyStorage.loadAddons();
    dead = global.MeflyStorage.loadDead();

    global.MeflyChannels.loadAll(addons).then(function (result) {
      allChannels = result.channels || [];
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
    }).catch(function (e) {
      statusEl.textContent = 'Erro ao carregar canais';
      emptyEl.classList.remove('hidden');
      console.error('[channels load]', e);
    });
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
      .slice(0, 20);

    groupsEl.innerHTML = '';
    var groups = ['Todos'].concat(top);
    for (var j = 0; j < groups.length; j++) {
      var g2 = groups[j];
      var btn = document.createElement('button');
      btn.className = 'group-chip focusable' + (g2 === currentGroup ? ' selected' : '');
      btn.textContent = g2;
      (function (gName) {
        btn.onclick = function () { currentGroup = gName; renderGroups(); applyFilter(); };
      })(g2);
      groupsEl.appendChild(btn);
    }
  }

  function applyFilter() {
    visibleChannels = allChannels.filter(function (c) {
      if (dead[c.id]) return false;
      if (currentGroup !== 'Todos' && String(c.group || '').trim() !== currentGroup) return false;
      return true;
    });
    renderGrid();
  }

  function renderGrid() {
    gridEl.innerHTML = '';
    if (!visibleChannels.length) {
      emptyEl.classList.remove('hidden');
      return;
    }
    emptyEl.classList.add('hidden');

    // Limita renderização inicial a 600 itens (TV não aguenta milhares de divs);
    // se houver mais, a paginação pode ser por scroll, mas a maioria dos addons
    // BR tem ~1000 canais — 600 cobre confortavelmente o visível.
    var max = Math.min(visibleChannels.length, 600);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < max; i++) {
      frag.appendChild(makeChannelCard(visibleChannels[i]));
    }
    gridEl.appendChild(frag);
  }

  function makeChannelCard(ch) {
    var card = document.createElement('button');
    card.className = 'channel focusable';
    card.setAttribute('data-id', ch.id);

    var thumb = document.createElement('div');
    thumb.className = 'channel-thumb';
    var emoji = document.createElement('span');
    emoji.className = 'emoji';
    emoji.textContent = '📺';
    thumb.appendChild(emoji);
    if (ch.logo) {
      var img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      // A logo começa INVISÍVEL e só aparece quando carrega 100%. Assim nunca
      // mostra imagem pela metade/quebrada — ou aparece inteira, ou fica o emoji.
      img.style.opacity = '0';
      img.style.transition = 'opacity 0.2s';
      img.onload = function () { img.style.opacity = '1'; };
      img.onerror = function () { img.style.display = 'none'; };
      img.src = ch.logo; // setar src DEPOIS dos handlers (cobre cache)
      thumb.appendChild(img);
    }

    var name = document.createElement('div');
    name.className = 'channel-name';
    name.textContent = ch.name;

    card.appendChild(thumb);
    card.appendChild(name);

    card.onclick = function () { openPlayer(ch); };
    return card;
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
    if (src) { imgEl.src = src; imgEl.style.display = ''; }
    else { imgEl.removeAttribute('src'); imgEl.style.display = 'none'; }
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
    var max = Math.min(visibleChannels.length, 300);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < max; i++) {
      var ch = visibleChannels[i];
      var btn = document.createElement('button');
      btn.className = 'player-list-item focusable' + (currentChannel && ch.id === currentChannel.id ? ' current' : '');
      var thumb = document.createElement('div');
      thumb.className = 'thumb';
      var em = document.createElement('span'); em.textContent = '📺'; thumb.appendChild(em);
      if (ch.logo) {
        var img = document.createElement('img'); img.alt = ''; img.loading = 'lazy';
        img.style.opacity = '0'; img.style.transition = 'opacity 0.2s';
        img.onload = function () { img.style.opacity = '1'; };
        img.onerror = function () { img.style.display = 'none'; };
        img.src = ch.logo;
        thumb.appendChild(img);
      }
      var name = document.createElement('span'); name.className = 'name'; name.textContent = ch.name;
      btn.appendChild(thumb); btn.appendChild(name);
      (function (chRef) { btn.onclick = function () { togglePlayerList(); openPlayer(chRef); }; })(ch);
      frag.appendChild(btn);
    }
    playerListBodyEl.appendChild(frag);
  }

  // Handler de teclas EXTRAS dentro do player (D-pad cima/baixo troca de canal)
  function playerKeyHandler(e, k) {
    if (playerEl.classList.contains('hidden')) return false;
    var KEY = global.MeflyNav.KEY;

    if (playerListVisible) {
      // Quando a lista está aberta, deixa a navegação normal funcionar.
      // Só o BACK fecha a lista (sem fechar o player).
      if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) {
        togglePlayerList();
        return true;
      }
      return false;
    }

    // Sem lista aberta: ↑↓ troca canal, OK abre lista, CH+/CH- também troca
    if (k === KEY.UP || k === KEY.CHUP) { zap(-1); showOSD(); return true; }
    if (k === KEY.DOWN || k === KEY.CHDOWN) { zap(1); showOSD(); return true; }
    if (k === KEY.OK) { togglePlayerList(); return true; }
    if (k === KEY.GREEN) { togglePlayerList(); return true; } // botão verde também
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

  global.MeflyUIChannels = {
    init: init,
    load: load
  };
})(window);

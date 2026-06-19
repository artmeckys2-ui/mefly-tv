/**
 * ui-settings.js — Tela de Configurações + modais.
 * Lista addons, adiciona (cola URL do manifest.json) e remove.
 */
(function (global) {
  'use strict';

  var listEl, btnAddEl;
  var modalAddon, modalConfirm;
  var addonInput, addonError;
  var confirmTitleEl, confirmMsgEl, btnConfirmYes, btnConfirmNo;
  var btnAddonSave, btnAddonCancel;
  var btnCheckUpdate, updateStatusEl;
  var m3uListEl, btnAddM3U, modalM3U, m3uNameInput, m3uUrlInput, m3uError, btnM3USave, btnM3UCancel;
  var pendingRemoveId = null;
  var pendingRemoveM3U = null; // url da lista M3U a remover

  function init() {
    listEl = document.getElementById('addons-list');
    btnAddEl = document.getElementById('btn-add-addon');

    modalAddon = document.getElementById('modal-addon');
    modalConfirm = document.getElementById('modal-confirm');
    addonInput = document.getElementById('addon-url');
    addonError = document.getElementById('addon-error');
    btnAddonSave = document.getElementById('btn-addon-save');
    btnAddonCancel = document.getElementById('btn-addon-cancel');
    confirmTitleEl = document.getElementById('confirm-title');
    confirmMsgEl = document.getElementById('confirm-msg');
    btnConfirmYes = document.getElementById('btn-confirm-yes');
    btnConfirmNo = document.getElementById('btn-confirm-no');

    btnCheckUpdate = document.getElementById('btn-check-update');
    updateStatusEl = document.getElementById('update-status');

    // M3U
    m3uListEl = document.getElementById('m3u-list');
    btnAddM3U = document.getElementById('btn-add-m3u');
    modalM3U = document.getElementById('modal-m3u');
    m3uNameInput = document.getElementById('m3u-name');
    m3uUrlInput = document.getElementById('m3u-url');
    m3uError = document.getElementById('m3u-error');
    btnM3USave = document.getElementById('btn-m3u-save');
    btnM3UCancel = document.getElementById('btn-m3u-cancel');

    btnAddEl.onclick = openAddonModal;
    btnAddonSave.onclick = saveAddon;
    btnAddonCancel.onclick = closeAddonModal;
    btnConfirmYes.onclick = doConfirm;
    btnConfirmNo.onclick = closeConfirmModal;
    if (btnCheckUpdate) btnCheckUpdate.onclick = checkUpdate;
    if (btnAddM3U) btnAddM3U.onclick = openM3UModal;
    if (btnM3USave) btnM3USave.onclick = saveM3U;
    if (btnM3UCancel) btnM3UCancel.onclick = closeM3UModal;

    // Botões de preset
    var presets = document.querySelectorAll('.preset');
    for (var i = 0; i < presets.length; i++) {
      (function (el) {
        el.onclick = function () { addonInput.value = el.getAttribute('data-url'); global.MeflyNav.setFocus(btnAddonSave); };
      })(presets[i]);
    }

    initPlaybackModes();
    initThemePicker();
  }

  // Card "Tema": alterna claro/escuro. Persiste em localStorage e aplica via
  // data-theme no <html> — o CSS lê as variáveis e troca tudo de cor sem
  // recarregar a página. O boot-script no <head> já leu isso antes do 1º
  // paint, então quem escolheu escuro nunca vê o flash da tela branca.
  function initThemePicker() {
    var btnLight = document.getElementById('theme-light');
    var btnDark = document.getElementById('theme-dark');
    if (!btnLight || !btnDark) return;
    function current() {
      try { return localStorage.getItem('mefly_tv_theme') || 'light'; } catch (_) { return 'light'; }
    }
    function paint() {
      var t = current();
      btnLight.classList.toggle('selected', t !== 'dark');
      btnDark.classList.toggle('selected', t === 'dark');
    }
    function pick(t) {
      try { localStorage.setItem('mefly_tv_theme', t); } catch (_) {}
      if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      else document.documentElement.removeAttribute('data-theme');
      paint();
    }
    btnLight.onclick = function () { pick('light'); };
    btnDark.onclick = function () { pick('dark'); };
    paint();
  }

  // Card "Reprodução": escolhe o modo padrão (Ao vivo / Estável). Vale pro
  // próximo canal aberto; no player dá pra alternar na hora com ◀▶ (D-pad).
  function initPlaybackModes() {
    var btnLive = document.getElementById('mode-live');
    var btnStable = document.getElementById('mode-stable');
    if (!btnLive || !btnStable) return;
    function paint() {
      var mode = (global.MeflyPlayer && global.MeflyPlayer.getMode) ? global.MeflyPlayer.getMode() : 'live';
      btnLive.classList.toggle('selected', mode === 'live');
      btnStable.classList.toggle('selected', mode === 'stable');
    }
    function pick(mode) {
      if (global.MeflyPlayer && global.MeflyPlayer.setMode) global.MeflyPlayer.setMode(mode);
      paint();
    }
    btnLive.onclick = function () { pick('live'); };
    btnStable.onclick = function () { pick('stable'); };
    paint();
  }

  function render() {
    var addons = global.MeflyStorage.loadAddons();
    listEl.innerHTML = '';

    if (!addons.length) {
      var empty = document.createElement('div');
      empty.className = 'muted';
      empty.style.padding = '12px 4px';
      empty.textContent = 'Nenhum addon instalado. Clique em "Adicionar addon" pra começar.';
      listEl.appendChild(empty);
      return;
    }

    for (var i = 0; i < addons.length; i++) {
      listEl.appendChild(makeAddonCard(addons[i]));
    }
    renderM3U();
  }

  function renderM3U() {
    if (!m3uListEl) return;
    var lists = global.MeflyStorage.loadM3ULists();
    m3uListEl.innerHTML = '';
    if (!lists.length) {
      var empty = document.createElement('div');
      empty.className = 'muted';
      empty.style.padding = '8px 4px';
      empty.textContent = 'Nenhuma lista adicionada ainda.';
      m3uListEl.appendChild(empty);
      return;
    }
    for (var i = 0; i < lists.length; i++) {
      (function (entry) {
        var card = document.createElement('div');
        card.className = 'addon-card focusable';
        var info = document.createElement('div'); info.className = 'info';
        var nm = document.createElement('div'); nm.className = 'name'; nm.textContent = entry.name || 'Minha lista';
        var url = document.createElement('div'); url.className = 'url'; url.textContent = entry.url;
        info.appendChild(nm); info.appendChild(url);
        var actions = document.createElement('div'); actions.className = 'actions';
        var btnRem = document.createElement('button');
        btnRem.className = 'btn btn-danger focusable'; btnRem.textContent = 'Remover';
        btnRem.onclick = function () { askRemoveM3U(entry); };
        actions.appendChild(btnRem);
        card.appendChild(info); card.appendChild(actions);
        card.onclick = function () { askRemoveM3U(entry); };
        m3uListEl.appendChild(card);
      })(lists[i]);
    }
  }

  function makeAddonCard(addon) {
    var card = document.createElement('div');
    card.className = 'addon-card focusable';

    var info = document.createElement('div');
    info.className = 'info';
    var nameLine = document.createElement('div');
    nameLine.className = 'name';
    nameLine.textContent = addon.name || addon.id;
    if (addon.enabled !== false) {
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'ATIVO';
      badge.style.marginLeft = '10px';
      nameLine.appendChild(badge);
    }
    var urlLine = document.createElement('div');
    urlLine.className = 'url';
    urlLine.textContent = addon.manifestUrl || addon.baseUrl || '';
    info.appendChild(nameLine);
    info.appendChild(urlLine);

    var actions = document.createElement('div');
    actions.className = 'actions';

    // Botão "Reconectar": força re-baixar manifest + recarregar canais.
    // Útil quando o addon ficou off ou mudou de catálogo — em vez de
    // remover+adicionar.
    var btnReconnect = document.createElement('button');
    btnReconnect.className = 'btn focusable';
    btnReconnect.textContent = '🔄 Reconectar';
    btnReconnect.onclick = function (e) {
      if (e) e.stopPropagation();
      reconnectAddon(addon, btnReconnect);
    };

    var btnRemove = document.createElement('button');
    btnRemove.className = 'btn btn-danger focusable';
    btnRemove.textContent = 'Remover';
    btnRemove.onclick = function (e) { if (e) e.stopPropagation(); askRemove(addon); };

    actions.appendChild(btnReconnect);
    actions.appendChild(btnRemove);

    card.appendChild(info);
    card.appendChild(actions);

    // Card focada não dispara nada por padrão — só os botões internos agem,
    // pra evitar remover sem querer ao apertar OK na card inteira.
    return card;
  }

  /**
   * Re-baixa o manifest do addon e recarrega os canais. Mostra feedback no botão.
   * É o mesmo "auto-refresh" que roda quando o addon retorna vazio, mas disparado
   * manualmente quando o usuário desconfia que o addon caiu.
   */
  function reconnectAddon(addon, btnEl) {
    var label = btnEl.textContent;
    btnEl.textContent = '⏳ Reconectando…';
    btnEl.disabled = true;
    global.MeflyAddons.refreshManifest(addon).then(function (changed) {
      if (changed) {
        // Persiste no storage com os campos atualizados
        var stored = global.MeflyStorage.loadAddons();
        for (var i = 0; i < stored.length; i++) {
          if (stored[i].id === addon.id) {
            stored[i].name = addon.name;
            stored[i].version = addon.version;
            stored[i].description = addon.description;
            stored[i].logo = addon.logo;
            stored[i].baseUrl = addon.baseUrl;
            stored[i].catalogs = addon.catalogs;
            stored[i].types = addon.types;
            break;
          }
        }
        global.MeflyStorage.saveAddons(stored);
      }
      // Testa o catálogo de fato pra dar feedback honesto
      return global.MeflyAddons.fetchChannelsFromAddon(addon).then(function (list) {
        btnEl.textContent = label;
        btnEl.disabled = false;
        if (list && list.length > 0) {
          toast(addon.name + ' está ON (' + list.length + ' canais). Recarregando…', 'success');
          render();
          setTimeout(function () { if (global.MeflyUIChannels) global.MeflyUIChannels.load(); }, 600);
        } else {
          toast(addon.name + ' não respondeu. Talvez a URL tenha mudado — tente remover e adicionar de novo.', 'error');
        }
      });
    }).catch(function () {
      btnEl.textContent = label;
      btnEl.disabled = false;
      toast(addon.name + ' não respondeu. Verifique a internet ou a URL.', 'error');
    });
  }

  // ===== MODAL: Adicionar addon =====
  function openAddonModal() {
    addonInput.value = '';
    addonError.classList.add('hidden');
    addonError.textContent = '';
    modalAddon.classList.remove('hidden');
    global.MeflyNav.pushBackHandler(closeAddonModal);
    setTimeout(function () {
      global.MeflyNav.setFocus(addonInput);
    }, 80);
  }

  function closeAddonModal() {
    modalAddon.classList.add('hidden');
    global.MeflyNav.popBackHandler();
    setTimeout(function () { global.MeflyNav.setFocus(btnAddEl); }, 50);
  }

  function saveAddon() {
    var url = addonInput.value.trim();
    if (!url) {
      addonError.textContent = 'Cole a URL do manifest.json do addon.';
      addonError.classList.remove('hidden');
      return;
    }
    addonError.classList.add('hidden');
    btnAddonSave.textContent = 'Adicionando…';
    btnAddonSave.disabled = true;

    global.MeflyAddons.installFromManifest(url).then(function (addon) {
      var list = global.MeflyStorage.loadAddons();
      // Remove duplicado pelo id
      list = list.filter(function (a) { return a.id !== addon.id; });
      list.push(addon);
      global.MeflyStorage.saveAddons(list);
      btnAddonSave.textContent = 'Adicionar';
      btnAddonSave.disabled = false;
      closeAddonModal();
      render();
      toast('Addon "' + addon.name + '" adicionado!', 'success');
    }).catch(function (e) {
      btnAddonSave.textContent = 'Adicionar';
      btnAddonSave.disabled = false;
      addonError.textContent = 'Falha: ' + (e.message || 'verifique a URL.');
      addonError.classList.remove('hidden');
    });
  }

  // ===== MODAL: Adicionar lista M3U =====
  function openM3UModal() {
    m3uNameInput.value = '';
    m3uUrlInput.value = '';
    m3uError.classList.add('hidden');
    modalM3U.classList.remove('hidden');
    global.MeflyNav.pushBackHandler(closeM3UModal);
    setTimeout(function () { global.MeflyNav.setFocus(m3uNameInput); }, 80);
  }
  function closeM3UModal() {
    modalM3U.classList.add('hidden');
    global.MeflyNav.popBackHandler();
    setTimeout(function () { global.MeflyNav.setFocus(btnAddM3U); }, 50);
  }
  function saveM3U() {
    var url = (m3uUrlInput.value || '').trim();
    var name = (m3uNameInput.value || '').trim() || 'Minha lista';
    if (!/^https?:\/\//i.test(url)) {
      m3uError.textContent = 'Cole uma URL válida (começa com http:// ou https://).';
      m3uError.classList.remove('hidden');
      return;
    }
    m3uError.classList.add('hidden');
    btnM3USave.textContent = 'Verificando…';
    btnM3USave.disabled = true;
    // Testa se a URL responde e parece um M3U antes de salvar
    fetch(url, { method: 'GET' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (txt) {
      if (txt.indexOf('#EXTM3U') < 0 && txt.indexOf('#EXTINF') < 0) {
        throw new Error('Isso não parece uma lista M3U.');
      }
      global.MeflyStorage.addM3UList({ name: name, url: url });
      btnM3USave.textContent = 'Adicionar'; btnM3USave.disabled = false;
      closeM3UModal();
      render();
      toast('Lista "' + name + '" adicionada! Recarregando canais…', 'success');
      // Recarrega os canais pra já entrar a lista nova
      setTimeout(function () { if (global.MeflyUIChannels) global.MeflyUIChannels.load(); }, 600);
    }).catch(function (e) {
      btnM3USave.textContent = 'Adicionar'; btnM3USave.disabled = false;
      m3uError.textContent = 'Falha: ' + (e.message || 'verifique a URL.');
      m3uError.classList.remove('hidden');
    });
  }
  function askRemoveM3U(entry) {
    pendingRemoveM3U = entry.url;
    confirmTitleEl.textContent = 'Remover lista?';
    confirmMsgEl.textContent = '"' + (entry.name || 'lista') + '" será removida. Os canais dela somem.';
    modalConfirm.classList.remove('hidden');
    global.MeflyNav.pushBackHandler(closeConfirmModal);
    setTimeout(function () { global.MeflyNav.setFocus(btnConfirmNo); }, 50);
  }

  // ===== MODAL: Confirmar remoção =====
  function askRemove(addon) {
    pendingRemoveId = addon.id;
    confirmTitleEl.textContent = 'Remover addon?';
    confirmMsgEl.textContent = '"' + (addon.name || addon.id) + '" será removido. Você pode adicionar de novo depois.';
    modalConfirm.classList.remove('hidden');
    global.MeflyNav.pushBackHandler(closeConfirmModal);
    setTimeout(function () { global.MeflyNav.setFocus(btnConfirmNo); }, 50);
  }

  function closeConfirmModal() {
    modalConfirm.classList.add('hidden');
    pendingRemoveId = null;
    pendingRemoveM3U = null;
    global.MeflyNav.popBackHandler();
    setTimeout(function () { global.MeflyNav.focusFirst(); }, 50);
  }

  function doConfirm() {
    // Remoção de lista M3U
    if (pendingRemoveM3U) {
      global.MeflyStorage.removeM3UList(pendingRemoveM3U);
      toast('Lista removida.', 'success');
      closeConfirmModal();
      render();
      setTimeout(function () { if (global.MeflyUIChannels) global.MeflyUIChannels.load(); }, 400);
      return;
    }
    // Remoção de addon
    if (!pendingRemoveId) { closeConfirmModal(); return; }
    var list = global.MeflyStorage.loadAddons().filter(function (a) { return a.id !== pendingRemoveId; });
    global.MeflyStorage.saveAddons(list);
    toast('Addon removido.', 'success');
    closeConfirmModal();
    render();
  }

  // ===== ATUALIZAÇÃO =====
  function checkUpdate() {
    if (!updateStatusEl) return;
    btnCheckUpdate.disabled = true;
    updateStatusEl.innerHTML = '<span class="update-spin"></span> Procurando atualizações…';

    var current = (window.MeflyApp && window.MeflyApp.version) || '0';
    // Busca a versão publicada (version.json ao lado do app), sem cache.
    var bust = 'nocache=' + Date.now();
    fetch('version.json?' + bust, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var remote = data && data.version;
        if (!remote) {
          // Sem arquivo de versão: faz reload "forçado" mesmo assim.
          updateStatusEl.textContent = 'Recarregando a versão mais recente…';
          setTimeout(forceReload, 800);
          return;
        }
        if (remote !== current) {
          updateStatusEl.innerHTML = 'Nova versão <b>' + remote + '</b> encontrada! Atualizando…';
          toast('Atualizando para a versão ' + remote + '…', 'success');
          setTimeout(forceReload, 1200);
        } else {
          updateStatusEl.textContent = 'Você já está na versão mais recente (' + current + '). ✓';
          btnCheckUpdate.disabled = false;
        }
      })
      .catch(function () {
        // Falhou rede: ainda assim oferece reload forçado.
        updateStatusEl.textContent = 'Não consegui verificar online. Recarregando mesmo assim…';
        setTimeout(forceReload, 1000);
      });
  }

  function forceReload() {
    try {
      // Limpa caches do app (se a TV suportar) e recarrega do servidor.
      if (window.caches && caches.keys) {
        caches.keys().then(function (keys) {
          keys.forEach(function (k) { caches.delete(k); });
        }).catch(function () {});
      }
    } catch (_) {}
    try { location.reload(true); } catch (_) { location.reload(); }
  }

  // ===== TOAST =====
  var toastTimer = null;
  function toast(msg, kind) {
    var el = document.getElementById('toast');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2800);
  }

  global.MeflyUISettings = {
    init: init,
    render: render,
    toast: toast
  };
})(window);

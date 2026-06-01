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
  var pendingRemoveId = null;

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

    btnAddEl.onclick = openAddonModal;
    btnAddonSave.onclick = saveAddon;
    btnAddonCancel.onclick = closeAddonModal;
    btnConfirmYes.onclick = doConfirm;
    btnConfirmNo.onclick = closeConfirmModal;
    if (btnCheckUpdate) btnCheckUpdate.onclick = checkUpdate;

    // Botões de preset
    var presets = document.querySelectorAll('.preset');
    for (var i = 0; i < presets.length; i++) {
      (function (el) {
        el.onclick = function () { addonInput.value = el.getAttribute('data-url'); global.MeflyNav.setFocus(btnAddonSave); };
      })(presets[i]);
    }
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
    var btnRemove = document.createElement('button');
    btnRemove.className = 'btn btn-danger focusable';
    btnRemove.textContent = 'Remover';
    btnRemove.onclick = function () { askRemove(addon); };
    actions.appendChild(btnRemove);

    card.appendChild(info);
    card.appendChild(actions);

    // Quando a CARD ganha foco, redireciona pro botão Remover (mais útil)
    card.onclick = function () { askRemove(addon); };
    return card;
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
    global.MeflyNav.popBackHandler();
    setTimeout(function () { global.MeflyNav.focusFirst(); }, 50);
  }

  function doConfirm() {
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

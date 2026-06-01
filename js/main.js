/**
 * main.js — Bootstrap + navegação de telas + sidebar + Voltar inteligente.
 */
(function () {
  'use strict';

  var currentScreen = 'channels';
  var APP_VERSION = '2.1.0';

  function showScreen(name) {
    currentScreen = name;
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
    var target = document.getElementById('screen-' + name);
    if (target) target.classList.add('active');

    var items = document.querySelectorAll('#topbar .tb-item');
    for (var j = 0; j < items.length; j++) {
      items[j].classList.toggle('active', items[j].getAttribute('data-screen') === name);
    }

    if (name === 'channels') {
      setTimeout(function () { window.MeflyNav.focusFirst(); }, 60);
    } else if (name === 'favorites') {
      window.MeflyUIChannels.renderFavorites();
      setTimeout(function () { window.MeflyNav.focusFirst(); }, 60);
    } else if (name === 'settings') {
      window.MeflyUISettings.render();
      setTimeout(function () { window.MeflyNav.focusFirst(); }, 60);
    }
  }

  function tickClock() {
    var d = new Date();
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    var el = document.getElementById('clock');
    if (el) el.textContent = hh + ':' + mm;
  }

  function bindNav() {
    var items = document.querySelectorAll('#topbar .tb-item');
    for (var i = 0; i < items.length; i++) {
      (function (btn) {
        btn.onclick = function () { showScreen(btn.getAttribute('data-screen')); };
      })(items[i]);
    }
  }

  // ===== VOLTAR INTELIGENTE =====
  // 1º Voltar (no conteúdo) => foca o menu do topo, NÃO sai do app.
  // 2º Voltar (já no menu) => aí sim sai do app.
  function smartBack() {
    var bar = document.getElementById('topbar');
    var f = window.MeflyNav.getFocus();
    var inMenu = f && bar.contains(f);

    if (!inMenu) {
      // Está no conteúdo → manda o foco pro item ativo do topo
      var active = bar.querySelector('.tb-item.active') || bar.querySelector('.tb-item');
      if (active) { window.MeflyNav.setFocus(active); }
      return true; // consumiu o Voltar (não sai)
    }
    // Já está no menu → deixa sair do app (retorna false = não consome)
    return false;
  }

  function hideSplash() {
    var sp = document.getElementById('splash');
    if (!sp || sp.classList.contains('hide')) return;
    sp.classList.add('hide');
    setTimeout(function () { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 600);
  }

  window.addEventListener('DOMContentLoaded', function () {
    window.MeflyNav.init();
    window.MeflyUIChannels.init();
    window.MeflyUISettings.init();

    // Registra o handler raiz de Voltar (fica no fundo da pilha)
    window.MeflyNav.setRootBackHandler(smartBack);

    bindNav();
    tickClock();
    setInterval(tickClock, 30000);

    var vEl = document.getElementById('app-version');
    if (vEl) vEl.textContent = APP_VERSION;

    window.MeflyUIChannels.load(hideSplash);
    showScreen('channels');

    setTimeout(hideSplash, 12000);
  });

  window.MeflyApp = {
    showScreen: showScreen,
    version: APP_VERSION,
    reload: function () { window.MeflyUIChannels.load(); }
  };
})();

/**
 * main.js — Bootstrap + navegação de telas + Voltar inteligente.
 */
(function () {
  'use strict';

  var currentScreen = 'channels';
  var APP_VERSION = '2.6.5';

  function focusFirstInScreen(name) {
    var screen = document.getElementById('screen-' + name);
    if (screen) {
      var focusables = screen.querySelectorAll('.focusable');
      for (var i = 0; i < focusables.length; i++) {
        if (focusables[i].classList.contains('hidden')) continue;
        var rect = focusables[i].getBoundingClientRect();
        if (rect.width && rect.height) {
          window.MeflyNav.setFocus(focusables[i]);
          return;
        }
      }
    }
    var activeItem = document.querySelector('#sidebar .sb-item.active');
    if (activeItem) window.MeflyNav.setFocus(activeItem);
  }

  function showScreen(name) {
    currentScreen = name;
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
    var target = document.getElementById('screen-' + name);
    if (target) target.classList.add('active');

    var items = document.querySelectorAll('#sidebar .sb-item');
    for (var j = 0; j < items.length; j++) {
      items[j].classList.toggle('active', items[j].getAttribute('data-screen') === name);
    }

    // Sai da tela Ao Vivo → para captura em background pra não gastar banda à toa
    if (name !== 'live' && window.MeflyUIChannels.stopBgCapture) {
      window.MeflyUIChannels.stopBgCapture();
    }
    if (name === 'channels') {
      window.MeflyUIChannels.renderChannels();
      setTimeout(function () { focusFirstInScreen(name); }, 60);
    } else if (name === 'live') {
      window.MeflyUIChannels.renderLive();
      setTimeout(function () { focusFirstInScreen(name); }, 60);
    } else if (name === 'favorites') {
      window.MeflyUIChannels.renderFavorites();
      setTimeout(function () { focusFirstInScreen(name); }, 60);
    } else if (name === 'settings') {
      window.MeflyUISettings.render();
      setTimeout(function () { focusFirstInScreen(name); }, 60);
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
    var items = document.querySelectorAll('#sidebar .sb-item');
    for (var i = 0; i < items.length; i++) {
      (function (btn) {
        btn.onclick = function () { showScreen(btn.getAttribute('data-screen')); };
      })(items[i]);
    }
  }

  // VOLTAR INTELIGENTE — sobe um NÍVEL na hierarquia da tela:
  //   grid (canais) → categorias → sidebar → sai do app.
  // Esse é o "atalho pro topo" que a TV não tem nativamente: estando lá
  // embaixo na lista, 1 VOLTAR pula direto pras categorias (rolando a página
  // de volta), 2 VOLTAR vai pra sidebar, 3 VOLTAR sai. Sem precisar subir
  // canal por canal.
  function smartBack() {
    var bar = document.getElementById('sidebar');
    var f = window.MeflyNav.getFocus();
    if (!f) return false;
    if (bar.contains(f)) return false; // já na sidebar → app pode sair

    function zoneOf(el) {
      var p = el;
      while (p) {
        if (p.dataset && p.dataset.navZone) return p.dataset.navZone;
        p = p.parentElement;
      }
      return null;
    }

    var z = zoneOf(f);

    // Estou no grid → pula pras categorias (se existirem), rolando pro topo.
    if (z === 'grid') {
      var groups = document.getElementById('groups');
      if (groups) {
        var firstCat = groups.querySelector('.cat-chip.selected.focusable')
                    || groups.querySelector('.cat-chip.focusable')
                    || groups.querySelector('.focusable');
        if (firstCat) {
          try { window.scrollTo(0, 0); } catch (_) {}
          window.MeflyNav.setFocus(firstCat);
          return true;
        }
      }
    }

    // Categorias / search / settings / etc → sidebar.
    var active = bar.querySelector('.sb-item.active') || bar.querySelector('.sb-item');
    if (active) {
      try { window.scrollTo(0, 0); } catch (_) {}
      window.MeflyNav.setFocus(active);
      return true;
    }
    return false;
  }

  window.addEventListener('DOMContentLoaded', function () {
    window.MeflyNav.init();
    window.MeflyUIChannels.init();
    window.MeflyUISettings.init();

    window.MeflyNav.setRootBackHandler(smartBack);

    bindNav();
    tickClock();
    setInterval(tickClock, 30000);

    var vEl = document.getElementById('app-version');
    if (vEl) vEl.textContent = APP_VERSION;

    window.MeflyUIChannels.load();
    showScreen('channels');

    // Keep-alive dos addons
    setInterval(function () {
      try {
        var addons = window.MeflyStorage.loadAddons();
        window.MeflyAddons.warmUp(addons);
      } catch (_) {}
    }, 10 * 60 * 1000);
  });

  window.MeflyApp = {
    showScreen: showScreen,
    version: APP_VERSION,
    reload: function () { window.MeflyUIChannels.load(); }
  };
})();

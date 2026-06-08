/**
 * main.js — Bootstrap + navegação de telas + Voltar inteligente.
 */
(function () {
  'use strict';

  var currentScreen = 'channels';
  var APP_VERSION = '2.1.8';

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

    if (name === 'channels') {
      setTimeout(function () { window.MeflyNav.focusFirst(); }, 60);
    } else if (name === 'live') {
      window.MeflyUIChannels.renderLive();
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
    var items = document.querySelectorAll('#sidebar .sb-item');
    for (var i = 0; i < items.length; i++) {
      (function (btn) {
        btn.onclick = function () { showScreen(btn.getAttribute('data-screen')); };
      })(items[i]);
    }
  }

  // VOLTAR INTELIGENTE: do conteúdo → sidebar; do sidebar → sai do app.
  function smartBack() {
    var bar = document.getElementById('sidebar');
    var f = window.MeflyNav.getFocus();
    var inSidebar = f && bar.contains(f);

    if (!inSidebar) {
      var active = bar.querySelector('.sb-item.active') || bar.querySelector('.sb-item');
      if (active) { window.MeflyNav.setFocus(active); }
      return true;
    }
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

    window.MeflyNav.setRootBackHandler(smartBack);

    bindNav();
    tickClock();
    setInterval(tickClock, 30000);

    var vEl = document.getElementById('app-version');
    if (vEl) vEl.textContent = APP_VERSION;

    window.MeflyUIChannels.load(hideSplash);
    showScreen('channels');

    setTimeout(hideSplash, 12000);

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

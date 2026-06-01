/**
 * main.js — Bootstrap + navegação de telas + sidebar + Voltar inteligente.
 */
(function () {
  'use strict';

  var currentScreen = 'channels';
  var APP_VERSION = '1.5.0';

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

  // Sidebar: "abre" (mostra textos) quando o foco está dentro dela.
  function updateSidebarOpen() {
    var sb = document.getElementById('sidebar');
    var f = window.MeflyNav.getFocus();
    var inside = f && sb.contains(f);
    sb.classList.toggle('open', !!inside);
  }

  function bindNav() {
    var items = document.querySelectorAll('#sidebar .sb-item');
    for (var i = 0; i < items.length; i++) {
      (function (btn) {
        btn.onclick = function () { showScreen(btn.getAttribute('data-screen')); };
      })(items[i]);
    }
  }

  // ===== VOLTAR INTELIGENTE =====
  // 1º Voltar (estando no conteúdo) => foca o menu lateral, NÃO sai do app.
  // 2º Voltar (já no menu) => aí sim sai do app (comportamento padrão webOS).
  function smartBack() {
    var sb = document.getElementById('sidebar');
    var f = window.MeflyNav.getFocus();
    var inMenu = f && sb.contains(f);

    if (!inMenu) {
      // Está no conteúdo → volta o foco pro item ativo do menu
      var active = sb.querySelector('.sb-item.active') || sb.querySelector('.sb-item');
      if (active) { window.MeflyNav.setFocus(active); updateSidebarOpen(); }
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

    // Atualiza o "abre/fecha" da sidebar a cada mudança de foco
    window.MeflyNav.onFocusChange(updateSidebarOpen);
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

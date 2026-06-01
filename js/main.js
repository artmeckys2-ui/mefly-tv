/**
 * main.js — Bootstrap. Inicializa navegação, telas e carrega dados.
 */
(function () {
  'use strict';

  var currentScreen = 'channels';

  function showScreen(name) {
    currentScreen = name;
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
    var target = document.getElementById('screen-' + name);
    if (target) target.classList.add('active');

    // Atualiza estado do topnav
    var navs = document.querySelectorAll('#topnav .navbtn');
    for (var j = 0; j < navs.length; j++) {
      navs[j].classList.toggle('active', navs[j].getAttribute('data-screen') === name);
    }

    // Carrega/renderiza conteúdo
    if (name === 'channels') {
      // Já carregamos no bootstrap; só refoca
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
    var navs = document.querySelectorAll('#topnav .navbtn');
    for (var i = 0; i < navs.length; i++) {
      (function (btn) {
        btn.onclick = function () { showScreen(btn.getAttribute('data-screen')); };
      })(navs[i]);
    }
  }

  function hideSplash() {
    var sp = document.getElementById('splash');
    if (!sp || sp.classList.contains('hide')) return;
    sp.classList.add('hide');
    setTimeout(function () { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 600);
  }

  // Boot
  window.addEventListener('DOMContentLoaded', function () {
    // Inicializa módulos
    window.MeflyNav.init();
    window.MeflyUIChannels.init();
    window.MeflyUISettings.init();

    bindNav();
    tickClock();
    setInterval(tickClock, 30000);

    // Carrega canais ao abrir. Quando terminar (ou falhar), tira o splash.
    window.MeflyUIChannels.load(hideSplash);

    // Mostra tela inicial
    showScreen('channels');

    // Rede de segurança: nunca deixa o splash travado por mais de 12s.
    setTimeout(hideSplash, 12000);
  });

  // Expõe pra console facilitar debug
  window.MeflyApp = {
    showScreen: showScreen,
    reload: function () { window.MeflyUIChannels.load(); }
  };
})();

/**
 * navigation.js — Navegação por CONTROLE REMOTO (D-pad).
 *
 * Funciona em LG webOS (keycodes 37/38/39/40/13/461), Android TV
 * e qualquer ambiente que dispara KeyboardEvent.
 *
 * Estratégia:
 *  - Lista todos os elementos com classe ".focusable" visíveis na tela atual
 *  - Move foco pela proximidade GEOMÉTRICA (não pela ordem do DOM)
 *  - Aplica a classe ".focus" no elemento ativo (CSS já cuida do destaque)
 *  - "OK" (Enter): clica no foco atual
 *  - "Voltar" (Back / Esc / 461): chama callback registrado pra tela atual
 */
(function (global) {
  'use strict';

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
    ENTER: 13, OK: 13, BACK: 461, ESC: 27, BACKSPACE: 8,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    PLAY: 415, PAUSE: 19, STOP: 413,
    CHUP: 33, CHDOWN: 34
  };

  var currentFocus = null;
  var backHandlerStack = []; // pilha de handlers de "voltar"
  var globalKeyHandlers = []; // handlers extras (player, etc.)
  var focusChangeCbs = []; // callbacks quando o foco muda
  var rootBackHandler = null; // handler raiz (ex.: Voltar inteligente do menu)

  // PERFORMANCE — em TVs fracas, varrer 1200+ canais por toque de tecla
  // matava a navegação. Mudanças:
  //  1) só varremos os "containers ativos" (sidebar + tela ativa + modal/player
  //     visíveis), em vez do document inteiro. Isso TIRA do scan as outras
  //     telas não visíveis (Favoritos, Ao Vivo, Config).
  //  2) isVisible não anda mais pra cima por todo o DOM verificando "hidden"
  //     em cada pai — já garantimos isso ao escolher os roots. Basta checar
  //     a própria classe + se o retângulo tem tamanho.
  //  3) findInDirection chama getBoundingClientRect UMA vez por elemento
  //     (antes chamava 2x: uma em isVisible, outra em center).
  function activeRoots() {
    var roots = [];
    var sb = document.getElementById('sidebar');
    if (sb) roots.push(sb);
    var screen = document.querySelector('.screen.active');
    if (screen) roots.push(screen);
    var nodes = document.querySelectorAll('.modal, .player');
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].classList.contains('hidden')) roots.push(nodes[i]);
    }
    return roots;
  }

  function focusableElementsRaw() {
    var roots = activeRoots();
    var out = [];
    for (var r = 0; r < roots.length; r++) {
      var nodes = roots[r].querySelectorAll('.focusable');
      for (var i = 0; i < nodes.length; i++) out.push(nodes[i]);
    }
    return out;
  }

  function focusableElements() {
    var raw = focusableElementsRaw();
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var el = raw[i];
      if (el.classList.contains('hidden')) continue;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.push(el);
    }
    return out;
  }

  // isVisible exposto pra eventual uso externo — simplificado pra mesma regra.
  function isVisible(el) {
    if (!el) return false;
    if (el.classList.contains('hidden')) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Zona do elemento: sobe o DOM procurando data-nav-zone. Define LIMITES
  // claros (sidebar / categorias / grid / settings / modais / player) pra
  // navegação não "pular" entre áreas que não são vizinhas naturalmente.
  function getZone(el) {
    var p = el;
    while (p) {
      if (p.dataset && p.dataset.navZone) return p.dataset.navZone;
      p = p.parentElement;
    }
    return null;
  }

  // Regras de FRONTEIRA entre zonas — quando atravessar é permitido:
  //  - sidebar ↔ qualquer coisa: SÓ horizontal (←/→). Nunca ↑/↓.
  //  - search ↔ categories ↔ grid (mesma coluna vertical): SÓ vertical (↑/↓).
  //  - settings é uma "ilha" vertical: idem.
  // Se a transição não bate com a direção, a travessia é bloqueada — assim
  // RIGHT no fim das categorias NÃO cai no grid; LEFT no grid NÃO foge pra
  // sidebar; e por aí vai. Mesma zona = sempre liberado.
  function canCrossZone(fromZone, toZone, dir) {
    if (fromZone === toZone) return true;
    if (!fromZone || !toZone) return true;
    if (fromZone === 'sidebar' || toZone === 'sidebar') {
      return dir === 'left' || dir === 'right';
    }
    // demais zonas (search/categories/grid/settings) estão empilhadas
    // verticalmente — só atravessa por cima/baixo.
    return dir === 'up' || dir === 'down';
  }

  // Acha o próximo focável na direção dir, respeitando ZONA + EIXO.
  // Estratégia em 3 passes (com mesma pool de candidatos pré-filtrada):
  //  1) mesma zona, strict (eixo perpendicular se sobrepõe).
  //  2) mesma zona, loose (geométrico com forte penalidade no desalinhamento).
  //  3) cross-zone (só se a direção bate com a regra de fronteira).
  // OTIMIZAÇÃO: o rect de cada candidato é calculado UMA vez aqui e os 3
  // passes reaproveitam. Em TV com 1200 canais, isso corta dezenas de ms
  // de layout reads por toque de tecla. Também aplicamos um pré-filtro
  // por DIREÇÃO (descarta tudo que não está pro lado certo) antes de
  // qualquer scoring.
  function findInDirection(from, dir) {
    var raw = focusableElementsRaw();
    if (!raw.length) return null;
    var fromRect = from.getBoundingClientRect();
    var fromCx = fromRect.left + fromRect.width / 2;
    var fromCy = fromRect.top + fromRect.height / 2;
    var fromZone = getZone(from);

    // Coleta candidatos VÁLIDOS (na direção) com rect calculado.
    var cands = [];
    for (var i = 0; i < raw.length; i++) {
      var el = raw[i];
      if (el === from) continue;
      if (el.classList.contains('hidden')) continue;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var dx = cx - fromCx, dy = cy - fromCy;
      var primary, secondary;
      if (dir === 'right')      { if (dx <= 4) continue;  primary = dx;  secondary = Math.abs(dy); }
      else if (dir === 'left')  { if (dx >= -4) continue; primary = -dx; secondary = Math.abs(dy); }
      else if (dir === 'down')  { if (dy <= 4) continue;  primary = dy;  secondary = Math.abs(dx); }
      else                      { if (dy >= -4) continue; primary = -dy; secondary = Math.abs(dx); } // up
      var overlaps = (dir === 'right' || dir === 'left')
        ? !(r.bottom <= fromRect.top + 2 || r.top >= fromRect.bottom - 2)
        : !(r.right <= fromRect.left + 2 || r.left >= fromRect.right - 2);
      cands.push({ el: el, primary: primary, secondary: secondary, overlaps: overlaps, zone: getZone(el) });
    }
    if (!cands.length) return null;

    function pick(strict, allowCross) {
      var best = null, bestScore = Infinity;
      for (var i = 0; i < cands.length; i++) {
        var c = cands[i];
        var crossing = c.zone !== fromZone;
        if (crossing && !allowCross) continue;
        if (crossing && !canCrossZone(fromZone, c.zone, dir)) continue;
        if (strict && !c.overlaps) continue;
        var score = strict ? (c.primary + c.secondary * 0.5) : (c.primary + c.secondary * 6);
        if (crossing) score += 1000;
        if (score < bestScore) { bestScore = score; best = c.el; }
      }
      return best;
    }

    return pick(true, false) || pick(false, false) || pick(false, true);
  }

  function setFocus(el) {
    if (!el) return;
    if (currentFocus) {
      try { currentFocus.classList.remove('focus'); } catch (_) {}
    }
    currentFocus = el;
    el.classList.add('focus');
    // Tenta o foco nativo também (pra inputs aceitarem teclado virtual da TV)
    try { el.focus(); } catch (_) {}
    // Scroll pro elemento ficar visível — INSTANTÂNEO (smooth na TV pesa
    // muito: força composite contínuo + acumula scroll events que invalidam
    // qualquer cache. "instant" deixa a navegação responsiva.
    try {
      if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch (_) {}
    // Notifica quem observa mudança de foco (ex.: abrir/fechar sidebar)
    for (var i = 0; i < focusChangeCbs.length; i++) {
      try { focusChangeCbs[i](el); } catch (_) {}
    }
  }

  function focusFirst() {
    var els = focusableElements();
    if (!els.length) { currentFocus = null; return; }
    // Prefere o que tem data-default-focus
    for (var i = 0; i < els.length; i++) {
      if (els[i].hasAttribute('data-default-focus')) { setFocus(els[i]); return; }
    }
    setFocus(els[0]);
  }

  function move(dir) {
    if (!currentFocus || !isVisible(currentFocus)) {
      focusFirst();
      return;
    }
    var next = findInDirection(currentFocus, dir);
    if (next) setFocus(next);
  }

  function activate() {
    if (!currentFocus) return;
    // Se for um input de texto, NÃO clica (deixa o usuário digitar)
    if (currentFocus.tagName === 'INPUT' || currentFocus.tagName === 'TEXTAREA') {
      try { currentFocus.focus(); } catch (_) {}
      return;
    }
    try { currentFocus.click(); } catch (_) {}
  }

  function pushBackHandler(fn) { backHandlerStack.push(fn); }
  function popBackHandler() { backHandlerStack.pop(); }
  function handleBack() {
    // 1) Handlers empilhados (modais, player) têm prioridade.
    if (backHandlerStack.length) {
      var fn = backHandlerStack[backHandlerStack.length - 1];
      try { fn(); } catch (_) {}
      return true;
    }
    // 2) Handler raiz (Voltar inteligente): se retornar true, consumiu (não sai).
    if (rootBackHandler) {
      var consumed = false;
      try { consumed = rootBackHandler(); } catch (_) {}
      if (consumed) return true;
    }
    // 3) Senão, sinaliza que NÃO consumiu (o app pode fechar).
    return false;
  }

  // Voltar PROGRAMÁTICO — pra plataformas (ex.: Android/TCL) onde o botão
  // Voltar é um evento de sistema e NÃO chega como keydown 461 no app.
  // Reproduz a MESMA ordem do onKey: handlers extras (player) → handleBack.
  // Retorna true se algo consumiu (não deve sair) / false se já está na raiz
  // (o app nativo pode então fechar de verdade). NÃO chama window.close().
  function programmaticBack() {
    var fakeE = { keyCode: KEY.BACK, which: KEY.BACK, preventDefault: function () {}, __synthetic: true };
    for (var i = globalKeyHandlers.length - 1; i >= 0; i--) {
      try { if (globalKeyHandlers[i](fakeE, KEY.BACK)) return true; } catch (_) {}
    }
    return handleBack();
  }
  // Exposto globalmente pra casca nativa (Android TV) chamar via evaluateJavascript.
  global.__meflyBack = programmaticBack;

  function onKey(e) {
    var k = e.keyCode || e.which;

    // Handlers extras (player, modal customizado) — podem cancelar com return true
    for (var i = globalKeyHandlers.length - 1; i >= 0; i--) {
      var h = globalKeyHandlers[i];
      try { if (h(e, k)) { e.preventDefault(); return; } } catch (_) {}
    }

    // Inputs de texto: deixa as teclas alfanuméricas passarem;
    // só interceptamos D-pad, OK e Voltar.
    var isInput = currentFocus && (currentFocus.tagName === 'INPUT' || currentFocus.tagName === 'TEXTAREA');

    if (k === KEY.LEFT) { e.preventDefault(); move('left'); }
    else if (k === KEY.RIGHT) { e.preventDefault(); move('right'); }
    else if (k === KEY.UP) { e.preventDefault(); move('up'); }
    else if (k === KEY.DOWN) { e.preventDefault(); move('down'); }
    else if (k === KEY.ENTER) {
      // Pra input, Enter "confirma" — também deixamos clicar caso esteja num botão
      e.preventDefault();
      activate();
    }
    else if (k === KEY.BACK || k === KEY.ESC || (k === KEY.BACKSPACE && !isInput)) {
      e.preventDefault();
      var consumed = handleBack();
      // Não consumiu (já estava no menu) → aí sim fecha o app de verdade.
      if (!consumed) {
        try {
          if (typeof webOS !== 'undefined' && webOS.platformBack) webOS.platformBack();
          else window.close();
        } catch (_) { try { window.close(); } catch (e) {} }
      }
    }
  }

  function init() {
    document.addEventListener('keydown', onKey, true);
    // Com disableBackHistoryAPI=true no appinfo, o webOS NÃO dispara mais popstate
    // no botão Voltar — só o keydown (keyCode 461). Assim o Voltar roda UMA vez só
    // (antes rodava 2x: popstate + keydown, e o 2º "saía do app"). Não tratamos
    // popstate aqui de propósito.
  }

  global.MeflyNav = {
    init: init,
    focusFirst: focusFirst,
    setFocus: setFocus,
    getFocus: function () { return currentFocus; },
    move: move,
    pushBackHandler: pushBackHandler,
    popBackHandler: popBackHandler,
    setRootBackHandler: function (fn) { rootBackHandler = fn; },
    programmaticBack: programmaticBack,
    onFocusChange: function (fn) { if (typeof fn === 'function') focusChangeCbs.push(fn); },
    addKeyHandler: function (fn) { globalKeyHandlers.push(fn); },
    removeKeyHandler: function (fn) {
      var i = globalKeyHandlers.indexOf(fn);
      if (i >= 0) globalKeyHandlers.splice(i, 1);
    },
    KEY: KEY
  };
})(window);

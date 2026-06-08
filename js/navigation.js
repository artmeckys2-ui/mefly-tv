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

  function focusableElements(container) {
    container = container || document;
    var nodes = container.querySelectorAll('.focusable');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (isVisible(el)) out.push(el);
    }
    return out;
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.classList.contains('hidden')) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    // Verifica se algum ancestral está oculto
    var p = el.parentElement;
    while (p) {
      if (p.classList && p.classList.contains('hidden')) return false;
      if (p.style && (p.style.display === 'none' || p.style.visibility === 'hidden')) return false;
      p = p.parentElement;
    }
    return true;
  }

  function center(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, r: r };
  }

  // Acha o próximo focável na direção dir, respeitando o EIXO.
  // Estratégia em 2 passes:
  //  1) procura SÓ candidatos que sobrepõem o eixo perpendicular (mesma linha
  //     pra esquerda/direita, mesma coluna pra cima/baixo). Se achar, é esse.
  //  2) se não achar nenhum sobreposto (estamos no fim da linha/coluna), aí
  //     sim cai pra busca geométrica com penalidade forte no desalinhamento.
  // Assim, "pro lado" nunca pula pra outra fila quando ainda tem item ao lado.
  function findInDirection(from, dir) {
    var list = focusableElements();
    if (!list.length) return null;
    var fromRect = from.getBoundingClientRect();
    var fromC = center(from);

    function gather(strict) {
      var best = null, bestScore = Infinity;
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (el === from) continue;
        var c = center(el);
        var r = c.r;
        var dx = c.x - fromC.x;
        var dy = c.y - fromC.y;

        var primary, secondary, valid, overlaps;
        if (dir === 'right') {
          primary = dx; secondary = Math.abs(dy);
          valid = dx > 4;
          // overlap vertical: linhas se cruzam
          overlaps = !(r.bottom <= fromRect.top + 2 || r.top >= fromRect.bottom - 2);
        } else if (dir === 'left') {
          primary = -dx; secondary = Math.abs(dy);
          valid = dx < -4;
          overlaps = !(r.bottom <= fromRect.top + 2 || r.top >= fromRect.bottom - 2);
        } else if (dir === 'down') {
          primary = dy; secondary = Math.abs(dx);
          valid = dy > 4;
          // overlap horizontal: colunas se cruzam
          overlaps = !(r.right <= fromRect.left + 2 || r.left >= fromRect.right - 2);
        } else { // up
          primary = -dy; secondary = Math.abs(dx);
          valid = dy < -4;
          overlaps = !(r.right <= fromRect.left + 2 || r.left >= fromRect.right - 2);
        }

        if (!valid) continue;
        if (strict && !overlaps) continue;

        // No modo solto: penalidade muito forte no desalinhamento pra não
        // pular pra "outra coisa que está longe da direção".
        var score = strict ? (primary + secondary * 0.5) : (primary + secondary * 6);
        if (score < bestScore) { bestScore = score; best = el; }
      }
      return best;
    }

    return gather(true) || gather(false);
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
    // Scroll pro elemento ficar visível
    try {
      if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
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

/**
 * storage.js — Wrapper simples sobre localStorage.
 * Salva addons instalados e canais "fora do ar" (escondidos por 5h).
 */
(function (global) {
  'use strict';

  var ADDONS_KEY = 'mefly_tv_addons';
  var DEAD_KEY = 'mefly_tv_dead_channels';
  var DEAD_TTL = 5 * 60 * 60 * 1000; // 5h

  function safeParse(raw, fallback) {
    try { return raw ? JSON.parse(raw) : fallback; }
    catch (_) { return fallback; }
  }

  var Storage = {
    // ===== ADDONS =====
    loadAddons: function () {
      var arr = safeParse(localStorage.getItem(ADDONS_KEY), null);
      if (Array.isArray(arr) && arr.length) return arr;
      // 1ª vez — instala o FrostView TV de fábrica (mesmo padrão do app desktop)
      var defaults = [{
        id: 'com.frostview',
        name: 'FrostView TV',
        manifestUrl: 'https://frostview.up.railway.app/manifest.json',
        baseUrl: 'https://frostview.up.railway.app',
        enabled: true
      }];
      try { localStorage.setItem(ADDONS_KEY, JSON.stringify(defaults)); } catch (_) {}
      return defaults;
    },
    saveAddons: function (list) {
      try { localStorage.setItem(ADDONS_KEY, JSON.stringify(list || [])); } catch (_) {}
    },

    // ===== CANAIS MORTOS (some por 5h se não tocar) =====
    loadDead: function () {
      var obj = safeParse(localStorage.getItem(DEAD_KEY), {}) || {};
      var now = Date.now();
      var out = {};
      for (var k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, k) && (now - obj[k] < DEAD_TTL)) {
          out[k] = obj[k];
        }
      }
      return out;
    },
    markDead: function (id) {
      if (!id) return;
      var dead = Storage.loadDead();
      if (dead[id]) return;
      dead[id] = Date.now();
      try { localStorage.setItem(DEAD_KEY, JSON.stringify(dead)); } catch (_) {}
    },
    clearDead: function () {
      try { localStorage.removeItem(DEAD_KEY); } catch (_) {}
    }
  };

  global.MeflyStorage = Storage;
})(window);

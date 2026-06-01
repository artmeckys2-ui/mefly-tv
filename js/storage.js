/**
 * storage.js — Wrapper simples sobre localStorage.
 * Salva addons instalados e canais "fora do ar" (escondidos por 5h).
 */
(function (global) {
  'use strict';

  var ADDONS_KEY = 'mefly_tv_addons';
  var DEAD_KEY = 'mefly_tv_dead_channels';
  var FAV_KEY = 'mefly_tv_favorites';
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
    },

    // ===== FAVORITOS =====
    // Guarda o canal INTEIRO (id, name, logo, url/addonBase…) pra a aba de
    // Favoritos funcionar mesmo que a ordem/fonte dos canais mude.
    loadFavorites: function () {
      var arr = safeParse(localStorage.getItem(FAV_KEY), []);
      return Array.isArray(arr) ? arr : [];
    },
    isFavorite: function (id) {
      if (!id) return false;
      var favs = Storage.loadFavorites();
      for (var i = 0; i < favs.length; i++) if (favs[i].id === id) return true;
      return false;
    },
    // Alterna favorito. Retorna true se ficou favoritado, false se desfavoritou.
    toggleFavorite: function (channel) {
      if (!channel || !channel.id) return false;
      var favs = Storage.loadFavorites();
      var idx = -1;
      for (var i = 0; i < favs.length; i++) { if (favs[i].id === channel.id) { idx = i; break; } }
      if (idx >= 0) {
        favs.splice(idx, 1);
        try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch (_) {}
        return false;
      }
      // Salva uma cópia enxuta do canal
      favs.push({
        id: channel.id, name: channel.name, logo: channel.logo || '',
        type: channel.type || 'channel', group: channel.group || '',
        addonBase: channel.addonBase || '', addonName: channel.addonName || '',
        url: channel.url || ''
      });
      try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch (_) {}
      return true;
    }
  };

  global.MeflyStorage = Storage;
})(window);

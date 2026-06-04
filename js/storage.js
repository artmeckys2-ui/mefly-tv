/**
 * storage.js — Wrapper simples sobre localStorage.
 * Salva addons instalados e canais "fora do ar" (escondidos por 5h).
 */
(function (global) {
  'use strict';

  var ADDONS_KEY = 'mefly_tv_addons';
  var DEAD_KEY = 'mefly_tv_dead_channels';
  var FAV_KEY = 'mefly_tv_favorites';
  var M3U_KEY = 'mefly_tv_m3u_lists';
  var DEAD_TTL = 5 * 60 * 60 * 1000; // 5h

  function safeParse(raw, fallback) {
    try { return raw ? JSON.parse(raw) : fallback; }
    catch (_) { return fallback; }
  }

  var Storage = {
    // ===== ADDONS =====
    loadAddons: function () {
      var raw = localStorage.getItem(ADDONS_KEY);
      var arr = safeParse(raw, null);
      if (Array.isArray(arr)) {
        if (arr.length) {
          var migrated = false;
          for (var i = 0; i < arr.length; i++) {
            var addon = arr[i];
            if (addon && addon.id === 'com.frostview' &&
                (addon.manifestUrl === 'https://frostview.up.railway.app/manifest.json' ||
                 addon.baseUrl === 'https://frostview.up.railway.app')) {
              addon.manifestUrl = 'https://frostview.onrender.com/manifest.json';
              addon.baseUrl = 'https://frostview.onrender.com';
              migrated = true;
            }
          }
          if (migrated) {
            try { localStorage.setItem(ADDONS_KEY, JSON.stringify(arr)); } catch (_) {}
          }
          return arr;
        }
        // Lista vazia explícita: mantém vazia, o usuário removeu todos.
        return [];
      }
      // 1ª vez ou armazenamento corrompido — instala o FrostView TV de fábrica.
      var defaults = [{
        id: 'com.frostview',
        name: 'FrostView TV',
        manifestUrl: 'https://frostview.onrender.com/manifest.json',
        baseUrl: 'https://frostview.onrender.com',
        enabled: true
      }];
      try { localStorage.setItem(ADDONS_KEY, JSON.stringify(defaults)); } catch (_) {}
      return defaults;
    },
    saveAddons: function (list) {
      try { localStorage.setItem(ADDONS_KEY, JSON.stringify(list || [])); } catch (_) {}
    },

    // ===== LISTAS M3U (URLs de playlist IPTV do próprio usuário) =====
    // Formato universal de IPTV. O usuário cola a URL de uma lista .m3u e ela
    // vira canais — sem depender de addon Stremio que cai.
    loadM3ULists: function () {
      var arr = safeParse(localStorage.getItem(M3U_KEY), []);
      return Array.isArray(arr) ? arr : [];
    },
    saveM3ULists: function (list) {
      try { localStorage.setItem(M3U_KEY, JSON.stringify(list || [])); } catch (_) {}
    },
    addM3UList: function (entry) {
      var list = Storage.loadM3ULists();
      list = list.filter(function (e) { return e.url !== entry.url; }); // sem duplicar URL
      list.push(entry);
      Storage.saveM3ULists(list);
      return list;
    },
    removeM3UList: function (url) {
      var list = Storage.loadM3ULists().filter(function (e) { return e.url !== url; });
      Storage.saveM3ULists(list);
      return list;
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

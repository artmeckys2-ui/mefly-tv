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
  var WATCH_KEY = 'mefly_tv_watch';
  var DEAD_TTL = 5 * 60 * 60 * 1000; // 5h
  var WATCH_THRESHOLD = 10 * 60 * 1000; // 10min assistidos → entra em "Mais assistidos"
  var WATCH_MAX = 120; // teto de canais guardados (poda os mais antigos)

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
          // Migrações de URL do FrostView (o addon mudou de host algumas vezes).
          // O comportamento aqui é: se o addon armazenado aponta pra uma URL ANTIGA
          // conhecida, atualizamos pra atual sem o usuário precisar reinstalar.
          // Histórico: Railway (2024) → Render (early 2026) → CloutTeam (mid 2026).
          var FROST_OLD_HOSTS = [
            'https://frostview.up.railway.app',
            'https://frostview.onrender.com'
          ];
          var FROST_NEW_BASE = 'https://frostview.cloutteam.com';
          var migrated = false;
          for (var i = 0; i < arr.length; i++) {
            var addon = arr[i];
            if (addon && addon.id === 'com.frostview') {
              var oldBase = String(addon.baseUrl || '').replace(/\/+$/, '');
              if (FROST_OLD_HOSTS.indexOf(oldBase) >= 0) {
                addon.manifestUrl = FROST_NEW_BASE + '/manifest.json';
                addon.baseUrl = FROST_NEW_BASE;
                migrated = true;
              }
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
        manifestUrl: 'https://frostview.cloutteam.com/manifest.json',
        baseUrl: 'https://frostview.cloutteam.com',
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
    },

    // ===== MAIS ASSISTIDOS (tempo de exibição por canal) =====
    // Guarda, por canal: ms acumulados tocando + quando foi visto por último +
    // uma cópia enxuta do canal (igual aos favoritos, pra render mesmo se a
    // fonte/ordem mudar). Canal que passa de 10min vira "mais assistido".
    loadWatch: function () {
      var obj = safeParse(localStorage.getItem(WATCH_KEY), {}) || {};
      return (obj && typeof obj === 'object') ? obj : {};
    },
    // Soma `ms` de exibição no canal e marca como assistido AGORA.
    addWatch: function (channel, ms) {
      if (!channel || !channel.id || !ms || ms <= 0) return;
      var w = Storage.loadWatch();
      var rec = w[channel.id] || { ms: 0, last: 0, ch: null };
      rec.ms += ms;
      rec.last = Date.now();
      rec.ch = {
        id: channel.id, name: channel.name, logo: channel.logo || '',
        type: channel.type || 'channel', group: channel.group || '',
        addonBase: channel.addonBase || '', addonName: channel.addonName || '',
        url: channel.url || ''
      };
      w[channel.id] = rec;
      // Poda: mantém só os WATCH_MAX mais recentes pra não crescer sem limite.
      var ids = Object.keys(w);
      if (ids.length > WATCH_MAX) {
        ids.sort(function (a, b) { return (w[b].last || 0) - (w[a].last || 0); });
        var keep = {};
        for (var i = 0; i < WATCH_MAX; i++) keep[ids[i]] = w[ids[i]];
        w = keep;
      }
      try { localStorage.setItem(WATCH_KEY, JSON.stringify(w)); } catch (_) {}
    },
    // Canais que passaram do limiar de 10min, do mais RECENTE pro mais antigo.
    mostWatched: function () {
      var w = Storage.loadWatch();
      var arr = [];
      for (var id in w) {
        if (!Object.prototype.hasOwnProperty.call(w, id)) continue;
        var r = w[id];
        if (r && r.ch && (r.ms || 0) >= WATCH_THRESHOLD) arr.push(r);
      }
      arr.sort(function (a, b) { return (b.last || 0) - (a.last || 0); });
      return arr.map(function (r) { return r.ch; });
    },
    clearWatch: function () {
      try { localStorage.removeItem(WATCH_KEY); } catch (_) {}
    }
  };

  global.MeflyStorage = Storage;
})(window);

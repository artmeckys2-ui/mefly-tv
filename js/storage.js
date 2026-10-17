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
  var SERVERS_KEY = 'mefly_tv_servers';
  var WATCH_KEY = 'mefly_tv_watch';
  var USER_RULES_KEY = 'mefly_tv_user_channel_rules_v1';
  var KNOWN_CHANNELS_KEY = 'mefly_tv_known_channels_v1';
  var DEAD_TTL = 5 * 60 * 60 * 1000; // 5h
  var WATCH_THRESHOLD = 10 * 60 * 1000; // 10min assistidos → entra em "Mais assistidos"
  var WATCH_MAX = 120; // teto de canais guardados (poda os mais antigos)

  function safeParse(raw, fallback) {
    try { return raw ? JSON.parse(raw) : fallback; }
    catch (_) { return fallback; }
  }

  var EXPLICIT_CHANNEL_PATTERN = /xxx|porn|adult|hentai|er[oó]tic|18\s*\+|transexual|transsexual|transgender|transg[eê]ner[oa]|travesti|shemale|ladyboy|femboy|cross[\s-]?dresser|\banal\b|brazzers?|empregad[ao]|entead[oa]|fodendo|gozando|\bhetero\b|bra[sz]ileirinhas|homossexual|l[eé]sbic|maykelly|maru[\s_-]*karv|mc[\s_-]*mirell[ae]|mia[\s_-]*khalifa|moranguinho|pousando\s+no\s+amor|stephanie[\s_-]*silveira|suelen[\s_-]*luca|tati[\s_-]*zaq|teens?|thais[\s_-]*safitt|yesgirlz[\s_-]*com|yp[eê]\s*tv/i;
  var BLOCKED_CHANNEL_NAMES = [
    'comeu', 'comendo', 'curta', 'ensinando', 'layz resende', 'lara ruiva',
    'ketlin groisman', 'karyanne menezes', 'maikelly mahul', 'rita cadillac',
    'syfy', 'suelen lucca', 'chantageando'
  ];
  var userRulesCache = null;

  function normalizeChannelName(value) {
    return String(value || '').toLowerCase()
      .replace(/[áàâãä]/g, 'a').replace(/[éèêë]/g, 'e')
      .replace(/[íìîï]/g, 'i').replace(/[óòôõö]/g, 'o')
      .replace(/[úùûü]/g, 'u').replace(/ç/g, 'c')
      .replace(/\(?\s*\d{3,4}\s*p\s*\)?|\b(?:fhd|uhd|hd|sd|4k)\b/ig, ' ')
      .replace(/^\s*\d+\s*[|.):-]\s*/, '')
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function uniqueNames(first, second) {
    var out = [], seen = {};
    var values = (first || []).concat(second || []);
    for (var i = 0; i < values.length; i++) {
      if (typeof values[i] !== 'string') continue;
      var value = values[i].trim().replace(/\s+/g, ' ');
      var key = normalizeChannelName(value);
      if (!key || seen[key]) continue;
      seen[key] = true;
      out.push(value);
    }
    return out;
  }

  function loadUserRules() {
    if (userRulesCache) return userRulesCache;
    var source = global.MeflyUserRules || {};
    var local = safeParse(localStorage.getItem(USER_RULES_KEY), {}) || {};
    userRulesCache = {
      blockedNames: uniqueNames(source.blockedNames, local.blockedNames),
      unblockedNames: uniqueNames(source.unblockedNames, local.unblockedNames),
      sportsInclude: uniqueNames(source.sportsInclude, local.sportsInclude),
      sportsExclude: uniqueNames(source.sportsExclude, local.sportsExclude)
    };
    return userRulesCache;
  }

  function isBlockedChannel(channel) {
    var name = String(channel && channel.name || '');
    var normalized = ' ' + normalizeChannelName(name) + ' ';
    var rules = loadUserRules();
    for (var i = 0; i < rules.unblockedNames.length; i++) {
      if (normalizeChannelName(rules.unblockedNames[i]) === normalizeChannelName(name)) return false;
    }
    var titleWithoutQuality = name.replace(/\s+(?:fhd|uhd|hd|sd|4k)$/i, '').trim();
    if (EXPLICIT_CHANNEL_PATTERN.test(name + ' ' + String(channel && channel.group || '')) || /^red$/i.test(titleWithoutQuality)) return true;
    var terms = BLOCKED_CHANNEL_NAMES.concat(rules.blockedNames);
    for (var j = 0; j < terms.length; j++) {
      var term = normalizeChannelName(terms[j]);
      if (term && normalized.indexOf(' ' + term + ' ') >= 0) return true;
    }
    return false;
  }

  function channelAccessKey(channel) {
    return String(channel && channel.id || '');
  }

  var Storage = {
    // ===== ADDONS =====
    loadAddons: function () {
      var raw = localStorage.getItem(ADDONS_KEY);
      var arr = safeParse(raw, null);
      if (Array.isArray(arr)) {
        if (!arr.length) {
          // Lista vazia explícita: o usuário removeu tudo; nunca re-injetamos defaults.
          return [];
        }

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

      // 1ª vez ou armazenamento corrompido — instala os defaults de fábrica.
      var defaults = [
        {
          id: 'com.frostview',
          name: 'FrostView TV',
          manifestUrl: 'https://frostview.cloutteam.com/manifest.json',
          baseUrl: 'https://frostview.cloutteam.com',
          enabled: true
        },
        {
          id: 'com.fenixtv',
          name: 'FenixTV',
          manifestUrl: 'https://fenixtv.fenixhub.online/manifest.json',
          baseUrl: 'https://fenixtv.fenixhub.online',
          enabled: true
        },
        {
          id: 'com.flixnest',
          name: 'FlixNest',
          manifestUrl: 'https://flixnest.app/flix-streams/manifest.json',
          baseUrl: 'https://flixnest.app',
          enabled: true
        }
      ];
      try { localStorage.setItem(ADDONS_KEY, JSON.stringify(defaults)); } catch (_) {}
      return defaults;
    },
    saveAddons: function (list) {
      try { localStorage.setItem(ADDONS_KEY, JSON.stringify(list || [])); } catch (_) {}
    },
    isBlockedChannel: isBlockedChannel,
    seedKnownChannels: function (channels) {
      if (!channels || !channels.length) return false;
      if (Array.isArray(safeParse(localStorage.getItem(KNOWN_CHANNELS_KEY), null))) return false;
      var ids = [], seen = {};
      for (var i = 0; i < channels.length; i++) {
        var id = channelAccessKey(channels[i]);
        if (id && !seen[id] && !isBlockedChannel(channels[i])) { seen[id] = true; ids.push(id); }
      }
      try { localStorage.setItem(KNOWN_CHANNELS_KEY, JSON.stringify(ids)); } catch (_) { return false; }
      return true;
    },
    requiresChannelPasscode: function (channel) {
      if (!channel || isBlockedChannel(channel)) return false;
      var known = safeParse(localStorage.getItem(KNOWN_CHANNELS_KEY), null);
      return Array.isArray(known) && known.indexOf(channelAccessKey(channel)) < 0;
    },
    getSportsOverride: function (channel) {
      if (!channel) return null;
      var rules = loadUserRules();
      var key = String(channel.id || normalizeChannelName(channel.name));
      if (rules.sportsInclude.indexOf(key) >= 0) return true;
      if (rules.sportsExclude.indexOf(key) >= 0) return false;
      return null;
    },
    loadChannelRules: loadUserRules,
    toggleAddon: function (addonId, enabled) {
      var list = Storage.loadAddons();
      var changed = false;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === addonId) {
          var nextState = typeof enabled === 'boolean' ? enabled : (list[i].enabled === false);
          if (list[i].enabled !== nextState) {
            list[i].enabled = nextState;
            changed = true;
          }
          break;
        }
      }
      if (changed) Storage.saveAddons(list);
      return list;
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
      if (typeof entry.enabled === 'undefined') entry.enabled = true;
      list.push(entry);
      Storage.saveM3ULists(list);
      return list;
    },
    removeM3UList: function (url) {
      var list = Storage.loadM3ULists().filter(function (e) { return e.url !== url; });
      Storage.saveM3ULists(list);
      return list;
    },
    toggleM3UList: function (url, enabled) {
      var list = Storage.loadM3ULists();
      var changed = false;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].url === url) {
          var nextState = typeof enabled === 'boolean' ? enabled : (list[i].enabled === false);
          if (list[i].enabled !== nextState) {
            list[i].enabled = nextState;
            changed = true;
          }
          break;
        }
      }
      if (changed) Storage.saveM3ULists(list);
      return list;
    },

    // ===== SERVIDORES / FONTES PADRÃO =====
    // O app tem fontes internas (IPTV-org) além dos addons/lists do usuário.
    // Isso permite desligar a fonte fixa sem remover o addon/lista.
    loadServers: function () {
      var arr = safeParse(localStorage.getItem(SERVERS_KEY), null);
      if (!Array.isArray(arr)) {
        arr = [{ id: 'iptv-org', name: 'Servidor IPTV-Org', enabled: true }];
        try { localStorage.setItem(SERVERS_KEY, JSON.stringify(arr)); } catch (_) {}
        return arr;
      }
      var hasIptv = false;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].id === 'iptv-org') { hasIptv = true; break; }
      }
      if (!hasIptv) {
        arr.push({ id: 'iptv-org', name: 'Servidor IPTV-Org', enabled: true });
        try { localStorage.setItem(SERVERS_KEY, JSON.stringify(arr)); } catch (_) {}
      }
      return arr;
    },
    saveServers: function (list) {
      try { localStorage.setItem(SERVERS_KEY, JSON.stringify(list || [])); } catch (_) {}
    },
    toggleServer: function (id, enabled) {
      var list = Storage.loadServers();
      var changed = false;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === id) {
          var nextState = typeof enabled === 'boolean' ? enabled : (list[i].enabled === false);
          if (list[i].enabled !== nextState) {
            list[i].enabled = nextState;
            changed = true;
          }
          break;
        }
      }
      if (changed) Storage.saveServers(list);
      return list;
    },

    // ===== CANAIS MORTOS (some por 5h se não tocar) =====
    loadDead: function () {
      // Desabilitado propositalmente: não ocultar canais por falha temporária.
      // Isso evita que canais desapareçam da lista mesmo quando um stream falha
      // pontualmente ou quando a TV está com algum problema transitório.
      return {};
    },
    markDead: function (id) {
      // Nenhum canal deve ser removido automaticamente da grade.
      return;
    },
    clearDead: function () {
      return;
    },

    // ===== FAVORITOS =====
    // Guarda o canal INTEIRO (id, name, logo, url/addonBase…) pra a aba de
    // Favoritos funcionar mesmo que a ordem/fonte dos canais mude.
    loadFavorites: function () {
      var arr = safeParse(localStorage.getItem(FAV_KEY), []);
      if (!Array.isArray(arr)) return [];
      var allowed = arr.filter(function (channel) { return !isBlockedChannel(channel); });
      if (allowed.length !== arr.length) {
        try { localStorage.setItem(FAV_KEY, JSON.stringify(allowed)); } catch (_) {}
      }
      return allowed;
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

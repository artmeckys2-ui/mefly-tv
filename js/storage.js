/**
 * storage.js — Wrapper simples sobre localStorage.
 * Salva addons instalados e canais "fora do ar" (escondidos por 5h).
 */
(function (global) {
  'use strict';

  var ADDONS_KEY = 'mefly_tv_addons';
  var FENIX_ADDON_SEED_KEY = 'mefly_tv_fenix_addon_seeded_v1';
  var FROST_ADDON_SEED_KEY = 'mefly_tv_frost_addon_seeded_v1';
  var KNOWN_CHANNELS_KEY = 'mefly_tv_known_channels_v1';
  var USER_CHANNEL_RULES_KEY = 'mefly_tv_user_channel_rules_v1';
  var OBSERVED_BLOCKED_KEY = 'mefly_tv_observed_blocked_v1';
  var DEAD_KEY = 'mefly_tv_dead_channels';
  var FAV_KEY = 'mefly_tv_favorites';
  var M3U_KEY = 'mefly_tv_m3u_lists';
  var WATCH_KEY = 'mefly_tv_watch';
  var DEAD_TTL = 5 * 60 * 60 * 1000; // 5h
  var WATCH_THRESHOLD = 10 * 60 * 1000; // 10min assistidos → entra em "Mais assistidos"
  var WATCH_MAX = 120; // teto de canais guardados (poda os mais antigos)
  var EXPLICIT_CONTENT_PATTERN = /xxx|porn|adult|hentai|er[oó]tic|18\s*\+|transexual|transsexual|transgender|transg[eê]ner[oa]|travesti|shemale|ladyboy|femboy|cross[\s-]?dresser|\banal\b|brazzers?|empregad[ao]|entead[oa]|fodendo|gozando|\bhetero\b|bra[sz]ileirinhas|homossexual|l[eé]sbic|maykelly|maru[\s_-]*karv|mc[\s_-]*mirell[ae]|mia[\s_-]*khalifa|moranguinho|pousando\s+no\s+amor|stephanie[\s_-]*silveira|suelen[\s_-]*luca|tati[\s_-]*zaq|teens?|thais[\s_-]*safitt|yesgirlz[\s_-]*com|yp[eê]\s*tv/i;
  var BLOCKED_CHANNEL_NAMES = [
    'comeu', 'comendo', 'curta', 'ensinando', 'layz resende', 'lara ruiva',
    'ketlin groisman', 'karyanne menezes', 'maikelly mahul', 'rita cadillac',
    'syfy', 'suelen lucca', 'chantageando'
  ];
  var userChannelRulesCache = null;

  function safeParse(raw, fallback) {
    try { return raw ? JSON.parse(raw) : fallback; }
    catch (_) { return fallback; }
  }

  function addonIdKey(addon) {
    return String(addon && addon.id || '').trim().toLowerCase();
  }

  function addonUrlKey(addon) {
    return String(addon && (addon.manifestUrl || addon.baseUrl) || '').trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/[?#].*$/, '')
      .replace(/\/manifest\.json$/, '').replace(/\/+$/, '');
  }

  function dedupeAddons(list) {
    var out = [], seen = {}, changed = false;
    for (var i = 0; i < list.length; i++) {
      var addon = list[i];
      if (!addon || typeof addon !== 'object') { changed = true; continue; }
      var idKey = addonIdKey(addon);
      var urlKey = addonUrlKey(addon);
      var idSeenKey = idKey ? 'id:' + idKey : '';
      var urlSeenKey = urlKey ? 'url:' + urlKey : '';
      var key = undefined;
      if (idSeenKey && Object.prototype.hasOwnProperty.call(seen, idSeenKey)) key = seen[idSeenKey];
      else if (urlSeenKey && Object.prototype.hasOwnProperty.call(seen, urlSeenKey)) key = seen[urlSeenKey];
      if (key !== undefined) {
        if (addon.enabled !== false) out[key].enabled = true;
        if (idSeenKey) seen[idSeenKey] = key;
        if (urlSeenKey) seen[urlSeenKey] = key;
        changed = true;
        continue;
      }
      var index = out.length;
      out.push(addon);
      if (idSeenKey) seen[idSeenKey] = index;
      if (urlSeenKey) seen[urlSeenKey] = index;
    }
    return { list: out, changed: changed };
  }

  function hasAddon(list, id, url) {
    var targetId = String(id || '').toLowerCase();
    var targetUrl = addonUrlKey({ manifestUrl: url });
    for (var i = 0; i < list.length; i++) {
      if (addonIdKey(list[i]) === targetId || addonUrlKey(list[i]) === targetUrl) return true;
    }
    return false;
  }

  function normalizeBlockedName(value) {
    return String(value || '').toLowerCase()
      .replace(/[áàâãä]/g, 'a').replace(/[éèêë]/g, 'e')
      .replace(/[íìîï]/g, 'i').replace(/[óòôõö]/g, 'o')
      .replace(/[úùûü]/g, 'u').replace(/ç/g, 'c')
      .replace(/\(?\s*\d{3,4}\s*p\s*\)?|\b(?:fhd|uhd|hd|sd|4k)\b/ig, ' ')
      .replace(/^\s*\d+\s*[|.):-]\s*/, '')
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function hasBlockedName(name) {
    var normalized = ' ' + normalizeBlockedName(name) + ' ';
    var terms = BLOCKED_CHANNEL_NAMES.concat(loadUserChannelRules().blockedNames);
    for (var i = 0; i < terms.length; i++) {
      var term = normalizeBlockedName(terms[i]);
      if (term && normalized.indexOf(' ' + term + ' ') >= 0) return true;
    }
    return false;
  }

  function isAllowedChannelName(name) {
    var key = normalizeBlockedName(name);
    var allowed = loadUserChannelRules().unblockedNames;
    for (var i = 0; i < allowed.length; i++) {
      if (normalizeBlockedName(allowed[i]) === key) return true;
    }
    return false;
  }

  function uniqueTextList(first, second, normalize) {
    var out = [], seen = {};
    var values = (first || []).concat(second || []);
    for (var i = 0; i < values.length; i++) {
      if (typeof values[i] !== 'string') continue;
      var value = values[i].trim().replace(/\s+/g, ' ');
      var key = normalize ? normalize(value) : value;
      if (!key || seen[key]) continue;
      seen[key] = true;
      out.push(value);
    }
    return out;
  }

  function loadUserChannelRules() {
    if (userChannelRulesCache) return userChannelRulesCache;
    var source = global.MeflyUserRules || {};
    var local = safeParse(localStorage.getItem(USER_CHANNEL_RULES_KEY), {}) || {};
    userChannelRulesCache = {
      blockedNames: uniqueTextList(source.blockedNames, local.blockedNames, normalizeBlockedName),
      unblockedNames: uniqueTextList(source.unblockedNames, local.unblockedNames, normalizeBlockedName),
      sportsInclude: uniqueTextList(source.sportsInclude, local.sportsInclude),
      sportsExclude: uniqueTextList(source.sportsExclude, local.sportsExclude)
    };
    return userChannelRulesCache;
  }

  function isLocalhost() {
    return location.port === '8088' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  }

  function hasDevAccess() {
    return isLocalhost() && global.MeflyDevAccess === true;
  }

  function saveUserChannelRules(rules) {
    if (!hasDevAccess()) return Promise.reject(new Error('Ative o modo Developer no localhost.'));
    var clean = {
      blockedNames: uniqueTextList([], rules.blockedNames, normalizeBlockedName),
      unblockedNames: uniqueTextList([], rules.unblockedNames, normalizeBlockedName),
      sportsInclude: uniqueTextList([], rules.sportsInclude),
      sportsExclude: uniqueTextList([], rules.sportsExclude)
    };
    try { localStorage.setItem(USER_CHANNEL_RULES_KEY, JSON.stringify(clean)); } catch (_) {}
    userChannelRulesCache = clean;
    global.MeflyUserRules = clean;
    if (typeof fetch !== 'function') return Promise.reject(new Error('O servidor local não está disponível.'));
    return fetch('/api/user-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clean)
    }).then(function (response) {
      if (!response.ok) throw new Error('Não foi possível gravar as regras no app.');
      return clean;
    });
  }

  function rememberBlockedName(channel) {
    if (!isLocalhost()) return;
    var record = typeof channel === 'string' ? { name: channel } : {
      id: String(channel && channel.id || ''),
      name: String(channel && channel.name || ''),
      type: String(channel && channel.type || 'channel'),
      group: String(channel && channel.group || ''),
      addonBase: String(channel && channel.addonBase || ''),
      addonName: String(channel && channel.addonName || ''),
      sourceId: String(channel && channel.sourceId || ''),
      url: String(channel && channel.url || '')
    };
    var clean = record.name.trim();
    if (!clean) return;
    var observed = safeParse(localStorage.getItem(OBSERVED_BLOCKED_KEY), []);
    if (!Array.isArray(observed)) observed = [];
    var key = normalizeBlockedName(clean);
    for (var i = 0; i < observed.length; i++) {
      var existingName = typeof observed[i] === 'string' ? observed[i] : observed[i] && observed[i].name;
      if (normalizeBlockedName(existingName) === key) {
        if (record.id) observed[i] = record;
        try { localStorage.setItem(OBSERVED_BLOCKED_KEY, JSON.stringify(observed)); } catch (_) {}
        return;
      }
    }
    observed.push(record);
    if (observed.length > 300) observed.shift();
    try { localStorage.setItem(OBSERVED_BLOCKED_KEY, JSON.stringify(observed)); } catch (_) {}
  }

  function isBlockedChannel(channel) {
    var name = String(channel && channel.name || '');
    if (isAllowedChannelName(name)) return false;
    var group = String(channel && channel.group || '');
    var titleWithoutQuality = name.replace(/\s+(?:fhd|uhd|hd|sd|4k)$/i, '').trim();
    var blocked = EXPLICIT_CONTENT_PATTERN.test(name + ' ' + group) || hasBlockedName(name) || /^red$/i.test(titleWithoutQuality);
    if (blocked) rememberBlockedName(channel);
    return blocked;
  }

  function channelAccessKey(channel) {
    if (!channel) return '';
    var source = String(channel.sourceId || '');
    if (!source && channel.addonBase) {
      var base = String(channel.addonBase).replace(/\/manifest\.json$/i, '').replace(/\/+$/, '');
      var addons = safeParse(localStorage.getItem(ADDONS_KEY), []);
      for (var i = 0; i < addons.length; i++) {
        var addonBase = String(addons[i].baseUrl || addons[i].manifestUrl || '')
          .replace(/\/manifest\.json$/i, '').replace(/\/+$/, '');
        if (addonBase === base) { source = 'addon:' + addons[i].id; break; }
      }
      if (!source) source = String(channel.addonBase);
    }
    var name = String(channel.name || '')
      .replace(/\(?\s*\d{3,4}\s*p\s*\)?/ig, '')
      .replace(/\b(fhd|uhd|hd|sd|4k)\b/ig, '')
      .replace(/[^a-z0-9]/ig, '')
      .toLowerCase();
    return source + '|' + name;
  }

  var Storage = {
    // ===== ADDONS =====
    loadAddons: function () {
      var raw = localStorage.getItem(ADDONS_KEY);
      var arr = safeParse(raw, null);
      if (Array.isArray(arr)) {
        var unique = dedupeAddons(arr);
        arr = unique.list;
        if (arr.length) {
          var migrated = unique.changed;
          if (localStorage.getItem(FENIX_ADDON_SEED_KEY) !== '1') {
            if (!hasAddon(arr, 'com.fenixflix.beta', 'https://fenixtv.fenixhub.online/manifest.json')) {
              arr.push({
                id: 'com.fenixflix.beta',
                name: 'Fenix TV',
                manifestUrl: 'https://fenixtv.fenixhub.online/manifest.json',
                baseUrl: 'https://fenixtv.fenixhub.online',
                enabled: true
              });
              migrated = true;
            }
            try { localStorage.setItem(FENIX_ADDON_SEED_KEY, '1'); } catch (_) {}
          }
          if (localStorage.getItem(FROST_ADDON_SEED_KEY) !== '1') {
            if (!hasAddon(arr, 'com.frostview', 'https://frostview.cloutteam.com/manifest.json')) {
              arr.push({
                id: 'com.frostview',
                name: 'FrostView TV',
                manifestUrl: 'https://frostview.cloutteam.com/manifest.json',
                baseUrl: 'https://frostview.cloutteam.com',
                enabled: true
              });
              migrated = true;
            }
            try { localStorage.setItem(FROST_ADDON_SEED_KEY, '1'); } catch (_) {}
          }
          if (migrated) {
            try { localStorage.setItem(ADDONS_KEY, JSON.stringify(arr)); } catch (_) {}
          }
          return arr;
        }
        // Lista vazia explícita: mantém vazia, o usuário removeu todos.
        try { localStorage.setItem(FENIX_ADDON_SEED_KEY, '1'); } catch (_) {}
        try { localStorage.setItem(FROST_ADDON_SEED_KEY, '1'); } catch (_) {}
        return [];
      }
      // 1ª vez ou armazenamento corrompido — instala os addons padrão.
      var defaults = [{
        id: 'com.frostview',
        name: 'FrostView TV',
        manifestUrl: 'https://frostview.cloutteam.com/manifest.json',
        baseUrl: 'https://frostview.cloutteam.com',
        enabled: true
      }, {
        id: 'com.fenixflix.beta',
        name: 'Fenix TV',
        manifestUrl: 'https://fenixtv.fenixhub.online/manifest.json',
        baseUrl: 'https://fenixtv.fenixhub.online',
        enabled: true
      }];
      try {
        localStorage.setItem(ADDONS_KEY, JSON.stringify(defaults));
        localStorage.setItem(FENIX_ADDON_SEED_KEY, '1');
        localStorage.setItem(FROST_ADDON_SEED_KEY, '1');
      } catch (_) {}
      return defaults;
    },
    saveAddons: function (list) {
      var unique = dedupeAddons(Array.isArray(list) ? list : []);
      try { localStorage.setItem(ADDONS_KEY, JSON.stringify(unique.list)); } catch (_) {}
    },
    seedKnownChannels: function (channels) {
      var existing = safeParse(localStorage.getItem(KNOWN_CHANNELS_KEY), null);
      if (Array.isArray(existing)) return false;
      var keys = [], seen = {};
      for (var i = 0; i < channels.length; i++) {
        var key = channelAccessKey(channels[i]);
        if (key && !seen[key]) { seen[key] = true; keys.push(key); }
      }
      try { localStorage.setItem(KNOWN_CHANNELS_KEY, JSON.stringify(keys)); } catch (_) { return false; }
      return true;
    },
    requiresChannelPasscode: function (channel) {
      if (!channel || isBlockedChannel(channel)) return false;
      var known = safeParse(localStorage.getItem(KNOWN_CHANNELS_KEY), null);
      if (!Array.isArray(known)) return false;
      return known.indexOf(channelAccessKey(channel)) < 0;
    },
    getBlacklistEntries: function () {
      if (!hasDevAccess()) return [];
      var observed = safeParse(localStorage.getItem(OBSERVED_BLOCKED_KEY), []);
      var rules = loadUserChannelRules();
      var observedNames = (Array.isArray(observed) ? observed : []).map(function (entry) {
        return typeof entry === 'string' ? entry : String(entry && entry.name || '');
      });
      return uniqueTextList(observedNames.concat(rules.blockedNames), [], normalizeBlockedName).filter(function (name) {
        return !rules.unblockedNames.some(function (allowed) { return normalizeBlockedName(allowed) === normalizeBlockedName(name); });
      });
    },
    getObservedBlockedChannels: function () {
      if (!hasDevAccess()) return [];
      var observed = safeParse(localStorage.getItem(OBSERVED_BLOCKED_KEY), []);
      if (!Array.isArray(observed)) return [];
      var allowed = loadUserChannelRules().unblockedNames;
      return observed.filter(function (entry) {
        return entry && typeof entry === 'object' && entry.id && entry.name &&
          !allowed.some(function (name) { return normalizeBlockedName(name) === normalizeBlockedName(entry.name); });
      });
    },
    addBlockedName: function (name) {
      if (!hasDevAccess()) return Promise.reject(new Error('Ative o modo Developer no localhost.'));
      var clean = String(name || '').trim().replace(/\s+/g, ' ');
      var key = normalizeBlockedName(clean);
      if (!key) return Promise.reject(new Error('Nome de canal vazio.'));
      var rules = loadUserChannelRules();
      rules.unblockedNames = rules.unblockedNames.filter(function (entry) { return normalizeBlockedName(entry) !== key; });
      if (!rules.blockedNames.some(function (entry) { return normalizeBlockedName(entry) === key; })) rules.blockedNames.push(clean);
      return saveUserChannelRules(rules);
    },
    unblockChannel: function (name) {
      if (!hasDevAccess()) return Promise.reject(new Error('Ative o modo Developer no localhost.'));
      var clean = String(name || '').trim().replace(/\s+/g, ' ');
      var key = normalizeBlockedName(clean);
      if (!key) return Promise.reject(new Error('Nome de canal inválido.'));
      var rules = loadUserChannelRules();
      rules.blockedNames = rules.blockedNames.filter(function (entry) { return normalizeBlockedName(entry) !== key; });
      if (!rules.unblockedNames.some(function (entry) { return normalizeBlockedName(entry) === key; })) rules.unblockedNames.push(clean);
      return saveUserChannelRules(rules);
    },
    getSportsOverride: function (channel) {
      if (!channel) return null;
      var key = String(channel.id || normalizeBlockedName(channel.name));
      var rules = loadUserChannelRules();
      if (rules.sportsInclude.indexOf(key) >= 0) return true;
      if (rules.sportsExclude.indexOf(key) >= 0) return false;
      return null;
    },
    setSportsOverride: function (channel, include) {
      if (!hasDevAccess()) return Promise.reject(new Error('Ative o modo Developer no localhost.'));
      if (!channel) return Promise.reject(new Error('Canal inválido.'));
      var key = String(channel.id || normalizeBlockedName(channel.name));
      var rules = loadUserChannelRules();
      rules.sportsInclude = rules.sportsInclude.filter(function (entry) { return entry !== key; });
      rules.sportsExclude = rules.sportsExclude.filter(function (entry) { return entry !== key; });
      (include ? rules.sportsInclude : rules.sportsExclude).push(key);
      return saveUserChannelRules(rules);
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
      if (!Array.isArray(arr)) return [];
      var allowed = arr.filter(function (channel) { return !isBlockedChannel(channel); });
      if (allowed.length !== arr.length) {
        try { localStorage.setItem(FAV_KEY, JSON.stringify(allowed)); } catch (_) {}
      }
      return allowed;
    },
    isBlockedChannel: isBlockedChannel,
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
        addonBase: channel.addonBase || '', addonName: channel.addonName || '', sourceId: channel.sourceId || '',
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

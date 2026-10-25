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
  var knownChannelSnapshotLoaded = false;
  var knownChannelSnapshot = null;
  var knownChannelIndexSnapshot = null;
  var channelPasscodeDecisionCache = {};
  var addonSourceByBase = null;
  var lastDevAddonSnapshot = null;

  function safeParse(raw, fallback) {
    try { return raw ? JSON.parse(raw) : fallback; }
    catch (_) { return fallback; }
  }

  function getAddonSourceByBase(base) {
    if (!addonSourceByBase) {
      var addons = safeParse(localStorage.getItem(ADDONS_KEY), []);
      addonSourceByBase = {};
      if (Array.isArray(addons)) {
        for (var i = 0; i < addons.length; i++) {
          var addonBase = String(addons[i].baseUrl || addons[i].manifestUrl || '')
            .replace(/\/manifest\.json$/i, '').replace(/\/+$/, '');
          var key = '$' + addonBase;
          if (addonBase && !Object.prototype.hasOwnProperty.call(addonSourceByBase, key)) {
            addonSourceByBase[key] = 'addon:' + addons[i].id;
          }
        }
      }
    }
    return addonSourceByBase['$' + base] || '';
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

  function normalizePasscodeTerm(value) {
    var raw = String(value || '').trim().toLowerCase();
    var normalized = raw
      .replace(/[áàâãä]/g, 'a').replace(/[éèêë]/g, 'e')
      .replace(/[íìîï]/g, 'i').replace(/[óòôõö]/g, 'o')
      .replace(/[úùûü]/g, 'u').replace(/ç/g, 'c')
      .replace(/\(?\s*\d{3,4}\s*p\s*\)?/ig, ' ')
      .replace(/\b(?:fhd|uhd|hd|sd|4k)\b/ig, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return normalized || raw.replace(/[\u200D\uFE0E\uFE0F]/g, '').trim();
  }

  function matchesPasscodeTerm(channel, term) {
    var cleaned = normalizePasscodeTerm(term);
    if (!cleaned || !channel) return false;
    var haystacks = [
      String(channel.name || ''),
      String(channel.group || ''),
      String(channel.addonName || ''),
      String(channel.addonBase || '')
    ];
    if (!/[a-z0-9]/i.test(cleaned)) {
      var suffix = cleaned.replace(/[\u200D\uFE0E\uFE0F]/g, '');
      for (var suffixIndex = 0; suffixIndex < haystacks.length; suffixIndex++) {
        var value = String(haystacks[suffixIndex] || '').replace(/[\u200D\uFE0E\uFE0F]/g, '').trim();
        if (suffix && value.indexOf(suffix) >= 0) return true;
      }
      return false;
    }
    for (var i = 0; i < haystacks.length; i++) {
      if (normalizePasscodeTerm(haystacks[i]).indexOf(cleaned) >= 0) return true;
    }
    return false;
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

  function sameKnownChannelList(first, second) {
    if (first.length !== second.length) return false;
    for (var i = 0; i < first.length; i++) if (first[i] !== second[i]) return false;
    return true;
  }

  function loadUserChannelRules() {
    if (userChannelRulesCache) return userChannelRulesCache;
    var source = global.MeflyUserRules || {};
    var local = safeParse(localStorage.getItem(USER_CHANNEL_RULES_KEY), {}) || {};
    userChannelRulesCache = {
      blockedNames: uniqueTextList(source.blockedNames, local.blockedNames, normalizeBlockedName),
      unblockedNames: uniqueTextList(source.unblockedNames, local.unblockedNames, normalizeBlockedName),
      passcodeRequired: uniqueTextList(source.passcodeRequired, local.passcodeRequired, normalizeBlockedName),
      passcodeAllowed: uniqueTextList(source.passcodeAllowed, local.passcodeAllowed),
      passcodeTerms: uniqueTextList(source.passcodeTerms, local.passcodeTerms, normalizePasscodeTerm),
      knownChannels: canonicalizeKnownChannels((source.knownChannels || []).concat(local.knownChannels || [])),
      sportsInclude: uniqueTextList(source.sportsInclude, local.sportsInclude),
      sportsExclude: uniqueTextList(source.sportsExclude, local.sportsExclude)
    };
    return userChannelRulesCache;
  }

  function isLocalhost() {
    return location.port === '8088' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  }

  function syncDevAddonSnapshot(addons) {
    if (!isLocalhost() || typeof fetch !== 'function') return;
    var serialized = JSON.stringify(addons);
    if (serialized === lastDevAddonSnapshot) return;
    lastDevAddonSnapshot = serialized;
    fetch('/api/dev-addons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: serialized
    }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
    }).catch(function (error) {
      if (lastDevAddonSnapshot === serialized) lastDevAddonSnapshot = null;
      console.error('[addons sync] Não foi possível salvar a lista local:', error && error.message || error);
    });
  }

  function finishAddonLoad(addons) {
    syncDevAddonSnapshot(addons);
    return addons;
  }

  function hasDevAccess() {
    return isLocalhost() && global.MeflyDevAccess === true;
  }

  function saveUserChannelRules(rules) {
    if (!hasDevAccess()) return Promise.reject(new Error('Ative o modo Developer no localhost.'));
    var clean = {
      blockedNames: uniqueTextList([], rules.blockedNames, normalizeBlockedName),
      unblockedNames: uniqueTextList([], rules.unblockedNames, normalizeBlockedName),
      passcodeRequired: uniqueTextList([], rules.passcodeRequired, normalizeBlockedName),
      passcodeAllowed: uniqueTextList([], rules.passcodeAllowed),
      passcodeTerms: uniqueTextList([], rules.passcodeTerms, normalizePasscodeTerm),
      knownChannels: canonicalizeKnownChannels(rules.knownChannels || []),
      sportsInclude: uniqueTextList([], rules.sportsInclude),
      sportsExclude: uniqueTextList([], rules.sportsExclude)
    };
    return persistUserChannelRules(clean);
  }

  function persistUserChannelRules(clean) {
    try { localStorage.setItem(USER_CHANNEL_RULES_KEY, JSON.stringify(clean)); } catch (_) {}
    userChannelRulesCache = clean;
    global.MeflyUserRules = clean;
    channelPasscodeDecisionCache = {};
    if (!isLocalhost()) return Promise.resolve(clean);
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

  function saveKnownChannelSnapshot(known) {
    var rules = loadUserChannelRules();
    rules.knownChannels = canonicalizeKnownChannels(known || []);
    return persistUserChannelRules(rules);
  }

  function initializeKnownChannels() {
    var sharedRules = global.MeflyUserRules || {};
    var hasSharedBaseline = Array.isArray(sharedRules.knownChannels);
    var shared = canonicalizeKnownChannels(sharedRules.knownChannels || []);
    var rules = loadUserChannelRules();
    var local = canonicalizeKnownChannels(safeParse(localStorage.getItem(KNOWN_CHANNELS_KEY), []));
    var merged = hasSharedBaseline && !shared.length
      ? []
      : canonicalizeKnownChannels(shared.concat(rules.knownChannels || [], local));
    var resetLocalBaseline = hasSharedBaseline && !shared.length && rules.knownChannels.length > 0;
    if (hasSharedBaseline && !shared.length) rules.knownChannels = [];
    cacheKnownChannelSnapshot(merged);
    try { localStorage.setItem(KNOWN_CHANNELS_KEY, JSON.stringify(merged)); } catch (_) {}

    if (resetLocalBaseline) {
      return persistUserChannelRules(rules).catch(function (error) {
        console.warn('[channel rules sync]', error);
        return merged;
      });
    }

    if (isLocalhost() && !sameKnownChannelList(merged, shared)) {
      return saveKnownChannelSnapshot(merged).catch(function (error) {
        console.warn('[channel rules sync]', error);
        return merged;
      });
    }
    return Promise.resolve(merged);
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

  function normalizeKnownSourceKey(source) {
    var s = String(source || '').trim();
    if (!s) return s;
    s = s.replace(/^https?:\/\//i, '')
      .replace(/^stremio:\/\//i, '')
      .replace(/[?#].*$/, '')
      .replace(/\/manifest\.json$/i, '')
      .replace(/\/+$/, '');
    s = s.replace(/^addon:/i, 'addon:');
    if (/^(?:addon:)?(?:com\.fenixflix\.beta|fenixtv\.fenixhub\.online)$/i.test(s)) {
      return 'addon:fenixtv.fenixhub.online';
    }
    if (/^(?:addon:)?(?:com\.frostview|frostview\.cloutteam\.com)$/i.test(s)) {
      return 'addon:frostview.cloutteam.com';
    }
    return s;
  }

  function normalizeKnownChannelKey(value) {
    if (!value) return '';
    var text = String(value).trim();
    var separator = text.lastIndexOf('|');
    if (separator < 0) return text;
    var source = normalizeKnownSourceKey(text.substring(0, separator));
    var nameKey = String(text.substring(separator + 1) || '').trim();
    if (!source || !nameKey) return text;
    return source + '|' + nameKey;
  }

  function canonicalizeKnownChannels(known) {
    if (!Array.isArray(known)) return [];
    var out = [], seen = {};
    for (var i = 0; i < known.length; i++) {
      var normalized = normalizeKnownChannelKey(known[i]);
      if (!normalized || Object.prototype.hasOwnProperty.call(seen, '$' + normalized)) continue;
      seen['$' + normalized] = true;
      out.push(normalized);
    }
    return out;
  }

  function channelAccessKey(channel) {
    if (!channel) return '';
    var source = String(channel.sourceId || '');
    if (!source && channel.addonBase) {
      var base = String(channel.addonBase).replace(/\/manifest\.json$/i, '').replace(/\/+$/, '');
      source = getAddonSourceByBase(base);
      if (!source) source = String(channel.addonBase);
    }
    source = normalizeKnownSourceKey(source);
    return source + '|' + channelPasscodeNameKey(channel);
  }

  function channelPasscodeNameKey(channel) {
    return String(channel && channel.name || '')
      .replace(/\(?\s*\d{3,4}\s*p\s*\)?/ig, '')
      .replace(/\b(fhd|uhd|hd|sd|4k)\b/ig, '')
      .replace(/[^a-z0-9]/ig, '')
      .toLowerCase();
  }

  function channelPasscodeAllowKey(channel) {
    var accessKey = channelAccessKey(channel);
    var separator = accessKey.lastIndexOf('|');
    var source = separator >= 0 ? accessKey.substring(0, separator) : accessKey;
    source = normalizeKnownSourceKey(source);
    var addonHost = String(channel && channel.addonBase || '').toLowerCase()
      .replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (addonHost === 'fenixtv.fenixhub.online') source = 'addon:fenixtv.fenixhub.online';
    return source + '|' + channelPasscodeNameKey(channel);
  }

  function buildKnownChannelIndex(known) {
    var exact = {}, namesBySource = {};
    if (!Array.isArray(known)) return { exact: exact, namesBySource: namesBySource };
    for (var i = 0; i < known.length; i++) {
      var key = String(known[i] || '');
      var normalizedKey = key;
      var separator = key.lastIndexOf('|');
      if (separator >= 0) {
        var sourcePart = normalizeKnownSourceKey(key.substring(0, separator));
        normalizedKey = sourcePart + key.substring(separator);
      }
      exact['$' + normalizedKey] = true;
      if (separator < 0) continue;
      var sourceKey = '$' + normalizeKnownSourceKey(key.substring(0, separator));
      if (!namesBySource[sourceKey]) namesBySource[sourceKey] = {};
      namesBySource[sourceKey]['$' + key.substring(separator + 1)] = true;
    }
    return { exact: exact, namesBySource: namesBySource };
  }

  function cacheKnownChannelSnapshot(known) {
    var normalized = canonicalizeKnownChannels(Array.isArray(known) ? known : []);
    if (Array.isArray(known)) {
      var changed = normalized.length !== known.length;
      if (!changed) {
        for (var i = 0; i < known.length && !changed; i++) {
          if (String(known[i] || '') !== String(normalized[i] || '')) changed = true;
        }
      }
      if (changed) {
      try { localStorage.setItem(KNOWN_CHANNELS_KEY, JSON.stringify(normalized)); } catch (_) {}
      }
    }
    knownChannelSnapshot = normalized.length ? normalized : null;
    knownChannelIndexSnapshot = buildKnownChannelIndex(knownChannelSnapshot);
    channelPasscodeDecisionCache = {};
    knownChannelSnapshotLoaded = true;
  }

  function getKnownChannelSnapshot() {
    if (!knownChannelSnapshotLoaded) {
      var source = global.MeflyUserRules && global.MeflyUserRules.knownChannels || [];
      var local = safeParse(localStorage.getItem(KNOWN_CHANNELS_KEY), []);
      cacheKnownChannelSnapshot(canonicalizeKnownChannels(source.concat(Array.isArray(local) ? local : [])));
    }
    return { channels: knownChannelSnapshot, index: knownChannelIndexSnapshot };
  }

  function channelRequiresPasscode(channel, known, rules, knownIndex) {
    if (!channel) return false;
    var cacheKey = '$' + [
      channelAccessKey(channel),
      String(channel.name || '').toLowerCase(),
      normalizePasscodeTerm(channel.group),
      normalizePasscodeTerm(channel.addonName),
      normalizePasscodeTerm(channel.addonBase)
    ].join('|');
    if (Object.prototype.hasOwnProperty.call(channelPasscodeDecisionCache, cacheKey)) {
      return channelPasscodeDecisionCache[cacheKey];
    }

    var required = false;
    if (!isBlockedChannel(channel)) {
      var nameKey = channelPasscodeNameKey(channel);
      var requiredNames = rules.passcodeRequired || [];
      var allowed = rules.passcodeAllowed || [];
      var passcodeTerms = rules.passcodeTerms || [];
      var normalizedName = normalizeBlockedName(channel.name);
      var forceRequired = requiredNames.some(function (name) {
        return normalizeBlockedName(name) === normalizedName;
      });
      if (forceRequired) {
        required = true;
      } else if (nameKey && allowed.indexOf(channelPasscodeAllowKey(channel)) < 0) {
        var matchedTerm = false;
        for (var i = 0; i < passcodeTerms.length; i++) {
          if (matchesPasscodeTerm(channel, passcodeTerms[i])) { matchedTerm = true; break; }
        }
        if (!matchedTerm) {
          if (!Array.isArray(known) || !known.length) {
            required = true;
          } else {
            var accessKey = channelAccessKey(channel);
            if (!knownIndex.exact['$' + accessKey]) {
              var separator = accessKey.lastIndexOf('|');
              var source = separator >= 0 ? accessKey.substring(0, separator) : accessKey;
              var sourceKey = '$' + source;
              var names = knownIndex.namesBySource[sourceKey];
              var knownName = names && names['$' + nameKey];
              var addonHost = String(channel.addonBase || '').toLowerCase()
                .replace(/^https?:\/\//, '').replace(/\/+$/, '');
              if (!knownName && addonHost === 'fenixtv.fenixhub.online') {
                var legacyNames = knownIndex.namesBySource['$addon:com.fenixflix.beta'];
                knownName = legacyNames && legacyNames['$' + nameKey];
              }
              required = !knownName;
            }
          }
        }
      }
    }
    channelPasscodeDecisionCache[cacheKey] = required;
    return required;
  }

  function splitChannelsByPasscode(channels, known, rules, knownIndex) {
    var open = [], protectedChannels = [];
    knownIndex = knownIndex || buildKnownChannelIndex(known);
    for (var i = 0; i < channels.length; i++) {
      if (channelRequiresPasscode(channels[i], known, rules, knownIndex)) protectedChannels.push(channels[i]);
      else open.push(channels[i]);
    }
    return { open: open, protected: protectedChannels };
  }

  function reconcileKnownChannelSources(existing, channels) {
    var knownBySource = {}, currentBySource = {}, channelKeys = [],
      sourceMapKey, nameMapKey, accessKey, separator, source, nameKey;
    var usedLegacySources = {}, seenKeys = {};
    for (var i = 0; i < existing.length; i++) {
      accessKey = String(existing[i] || '');
      separator = accessKey.lastIndexOf('|');
      if (separator < 0) continue;
      source = normalizeKnownSourceKey(accessKey.substring(0, separator));
      nameKey = accessKey.substring(separator + 1);
      sourceMapKey = '$' + source;
      if (!knownBySource[sourceMapKey]) knownBySource[sourceMapKey] = {};
      knownBySource[sourceMapKey]['$' + nameKey] = true;
      seenKeys['$' + source + '|' + nameKey] = true;
    }
    for (var j = 0; j < channels.length; j++) {
      accessKey = channelAccessKey(channels[j]);
      separator = accessKey.lastIndexOf('|');
      if (separator < 0) continue;
      source = normalizeKnownSourceKey(accessKey.substring(0, separator));
      nameKey = accessKey.substring(separator + 1);
      sourceMapKey = '$' + source;
      if (!currentBySource[sourceMapKey]) currentBySource[sourceMapKey] = {};
      currentBySource[sourceMapKey]['$' + nameKey] = true;
      channelKeys.push({ key: source + '|' + nameKey, source: sourceMapKey, name: '$' + nameKey });
    }

    var currentSources = Object.keys(currentBySource);
    var oldSources = Object.keys(knownBySource);
    for (var c = 0; c < currentSources.length; c++) {
      var currentSource = currentSources[c];
      if (knownBySource[currentSource]) continue;
      var currentNames = Object.keys(currentBySource[currentSource]);
      var bestLegacySource = null;
      var bestOverlap = 0;
      for (var oldIndex = 0; oldIndex < oldSources.length; oldIndex++) {
        var oldSource = oldSources[oldIndex];
        if (usedLegacySources[oldSource]) continue;
        var oldNames = Object.keys(knownBySource[oldSource]);
        var overlap = 0;
        for (var n = 0; n < currentNames.length; n++) {
          if (Object.prototype.hasOwnProperty.call(knownBySource[oldSource], currentNames[n])) overlap++;
        }
        if (overlap < 5 || overlap / currentNames.length < 0.8 || overlap / oldNames.length < 0.8) continue;
        if (overlap > bestOverlap) { bestOverlap = overlap; bestLegacySource = oldSource; }
      }
      if (!bestLegacySource) continue;
      usedLegacySources[bestLegacySource] = true;
      var legacyNames = knownBySource[bestLegacySource];
      for (var k = 0; k < channelKeys.length; k++) {
        if (channelKeys[k].source !== currentSource ||
            !Object.prototype.hasOwnProperty.call(legacyNames, channelKeys[k].name) ||
            seenKeys['$' + channelKeys[k].key]) continue;
        seenKeys['$' + channelKeys[k].key] = true;
        existing.push(channelKeys[k].key);
      }
    }
    return existing;
  }

  var Storage = {
    // ===== ADDONS =====
    loadAddons: function () {
      addonSourceByBase = null;
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
          return finishAddonLoad(arr);
        }
        // Lista vazia explícita: mantém vazia, o usuário removeu todos.
        try { localStorage.setItem(FENIX_ADDON_SEED_KEY, '1'); } catch (_) {}
        try { localStorage.setItem(FROST_ADDON_SEED_KEY, '1'); } catch (_) {}
        return finishAddonLoad([]);
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
      return finishAddonLoad(defaults);
    },
    applyPublishedAddons: function () {
      if (isLocalhost()) return false;
      var config = global.MeflyPublishedAddonConfig;
      if (!config || !Array.isArray(config.addons) || !config.revision) return false;
      var unique = dedupeAddons(config.addons);
      try {
        localStorage.setItem(ADDONS_KEY, JSON.stringify(unique.list));
        localStorage.setItem(FENIX_ADDON_SEED_KEY, '1');
        localStorage.setItem(FROST_ADDON_SEED_KEY, '1');
      } catch (error) {
        console.error('[addons sync] Não foi possível atualizar a lista publicada:', error && error.message || error);
        return false;
      }
      addonSourceByBase = null;
      return true;
    },
    saveAddons: function (list) {
      var unique = dedupeAddons(Array.isArray(list) ? list : []);
      try { localStorage.setItem(ADDONS_KEY, JSON.stringify(unique.list)); } catch (_) {}
      try {
        localStorage.setItem(FENIX_ADDON_SEED_KEY, '1');
        localStorage.setItem(FROST_ADDON_SEED_KEY, '1');
      } catch (_) {}
      addonSourceByBase = null;
      syncDevAddonSnapshot(unique.list);
    },
    seedKnownChannels: function (channels) {
      var existing = getKnownChannelSnapshot().channels;
      if (!Array.isArray(channels) || !channels.length) return false;
      if (Array.isArray(existing) && existing.length) {
        var migrated = reconcileKnownChannelSources(existing.slice(), channels);
        if (migrated.length === existing.length) return Promise.resolve(false);
        try { localStorage.setItem(KNOWN_CHANNELS_KEY, JSON.stringify(migrated)); } catch (_) { return false; }
        cacheKnownChannelSnapshot(migrated);
        return saveKnownChannelSnapshot(migrated).then(function () {
          return true;
        }).catch(function (error) {
          console.warn('[channel rules sync]', error);
          return false;
        });
      }
      return Promise.resolve(false);
    },
    initializeKnownChannels: function () {
      return initializeKnownChannels();
    },
    requiresChannelPasscode: function (channel) {
      var known = getKnownChannelSnapshot();
      var rules = loadUserChannelRules();
      return channelRequiresPasscode(channel, known.channels, rules, known.index);
    },
    sortChannelsWithPasscodeLast: function (channels, hideProtected) {
      if (!Array.isArray(channels) || !channels.length) return channels || [];
      var known = getKnownChannelSnapshot();
      var split = splitChannelsByPasscode(channels, known.channels, loadUserChannelRules(), known.index);
      if (hideProtected) return split.open;
      return split.open.concat(split.protected);
    },
    getChannelsRequiringPasscode: function (channels) {
      if (!hasDevAccess()) return [];
      var source = Array.isArray(channels) ? channels : [];
      var known = getKnownChannelSnapshot();
      return splitChannelsByPasscode(source, known.channels, loadUserChannelRules(), known.index).protected;
    },
    allowChannelWithoutPasscode: function (channel) {
      if (!hasDevAccess()) return Promise.reject(new Error('Ative o modo Developer no localhost.'));
      var key = channelPasscodeAllowKey(channel);
      if (!key) return Promise.reject(new Error('Canal inválido.'));
      var rules = loadUserChannelRules();
      rules.passcodeRequired = (rules.passcodeRequired || []).filter(function (name) {
        return normalizeBlockedName(name) !== normalizeBlockedName(channel.name);
      });
      if (rules.passcodeAllowed.indexOf(key) < 0) rules.passcodeAllowed.push(key);
      return saveUserChannelRules(rules);
    },
    requireChannelPasscode: function (name) {
      if (!hasDevAccess()) return Promise.reject(new Error('Ative o modo Developer no localhost.'));
      var clean = String(name || '').trim().replace(/\s+/g, ' ');
      var key = normalizeBlockedName(clean);
      if (!key) return Promise.reject(new Error('Nome de canal inválido.'));
      var rules = loadUserChannelRules();
      rules.passcodeRequired = rules.passcodeRequired || [];
      if (!rules.passcodeRequired.some(function (entry) { return normalizeBlockedName(entry) === key; })) {
        rules.passcodeRequired.push(clean);
      }
      return saveUserChannelRules(rules);
    },
    getPasscodeTerms: function () {
      return (loadUserChannelRules().passcodeTerms || []).slice();
    },
    addPasscodeTerm: function (term) {
      if (!hasDevAccess()) return Promise.reject(new Error('Ative o modo Developer no localhost.'));
      var clean = String(term || '').trim().replace(/\s+/g, ' ');
      if (!clean) return Promise.reject(new Error('Termo de liberação vazio.'));
      var rules = loadUserChannelRules();
      var normalized = normalizePasscodeTerm(clean);
      if (!normalized) return Promise.reject(new Error('Termo de liberação inválido.'));
      if (!rules.passcodeTerms.some(function (entry) { return normalizePasscodeTerm(entry) === normalized; })) {
        rules.passcodeTerms.push(clean);
      }
      return saveUserChannelRules(rules);
    },
    removePasscodeTerm: function (term) {
      if (!hasDevAccess()) return Promise.reject(new Error('Ative o modo Developer no localhost.'));
      var clean = String(term || '').trim().replace(/\s+/g, ' ');
      var normalized = normalizePasscodeTerm(clean);
      if (!normalized) return Promise.reject(new Error('Termo de liberação inválido.'));
      var rules = loadUserChannelRules();
      rules.passcodeTerms = rules.passcodeTerms.filter(function (entry) { return normalizePasscodeTerm(entry) !== normalized; });
      return saveUserChannelRules(rules);
    },
    matchesPasscodeTerm: function (channel, term) {
      return matchesPasscodeTerm(channel, term);
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
      if (!rules.passcodeRequired) rules.passcodeRequired = [];
      if (!rules.passcodeRequired.some(function (entry) { return normalizeBlockedName(entry) === key; })) rules.passcodeRequired.push(clean);
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
    clearDeadForChannels: function (channels) {
      if (!Array.isArray(channels) || !channels.length) return;
      var dead = Storage.loadDead();
      var changed = false;
      for (var i = 0; i < channels.length; i++) {
        var id = channels[i] && channels[i].id;
        if (id && Object.prototype.hasOwnProperty.call(dead, id)) {
          delete dead[id];
          changed = true;
        }
      }
      if (!changed) return;
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

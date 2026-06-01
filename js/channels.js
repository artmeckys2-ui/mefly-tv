/**
 * channels.js — Agrega canais de TODOS os addons habilitados + iptv-org (URLs diretas).
 * Mesmo padrão do app desktop (routes/channels.js), só que rodando 100% no cliente.
 */
(function (global) {
  'use strict';

  // Fontes FIXAS e CONFIÁVEIS (GitHub Pages do iptv-org não cai e tem CORS aberto).
  // São URLs DIRETAS de HLS que tocam sem precisar resolver via addon.
  var IPTV_ORG_M3U = [
    'https://iptv-org.github.io/iptv/countries/br.m3u',  // Brasil (~250)
    'https://iptv-org.github.io/iptv/languages/por.m3u'  // Português (BR + PT)
  ];

  function parseM3U(text) {
    var out = [];
    var lines = String(text || '').split(/\r?\n/);
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (l.indexOf('#EXTINF') === 0) {
        var logo = (l.match(/tvg-logo="([^"]*)"/i) || [])[1] || '';
        var group = (l.match(/group-title="([^"]*)"/i) || [])[1] || '';
        var tvgId = (l.match(/tvg-id="([^"]*)"/i) || [])[1] || '';
        var name = (l.split(',').slice(1).join(',') || '').trim();
        cur = { logo: logo, group: group, tvgId: tvgId, name: name };
      } else if (l && l.charAt(0) !== '#' && cur) {
        cur.url = l;
        out.push(cur);
        cur = null;
      }
    }
    return out;
  }

  function fetchText(url, timeoutMs) {
    timeoutMs = timeoutMs || 20000;
    return new Promise(function (resolve, reject) {
      var controller, timer;
      try { if (typeof AbortController !== 'undefined') controller = new AbortController(); } catch (_) {}
      timer = setTimeout(function () {
        try { controller && controller.abort(); } catch (_) {}
        reject(new Error('timeout'));
      }, timeoutMs);
      var opts = {};
      if (controller) opts.signal = controller.signal;
      fetch(url, opts).then(function (r) {
        clearTimeout(timer);
        if (!r.ok) { reject(new Error('HTTP ' + r.status)); return; }
        return r.text();
      }).then(function (t) {
        if (t !== undefined) resolve(t);
      }).catch(function (e) {
        clearTimeout(timer); reject(e);
      });
    });
  }

  function loadIPTVorg() {
    var all = [];
    var seenUrl = {};
    return Promise.all(IPTV_ORG_M3U.map(function (url) {
      return fetchText(url, 22000).then(function (text) {
        var list = parseM3U(text);
        for (var i = 0; i < list.length; i++) {
          var ch = list[i];
          var u = String(ch.url || '').trim();
          if (!/^https?:\/\//i.test(u)) continue;
          if (seenUrl[u]) continue;
          if (/\[\s*not\s*24\/7\s*\]/i.test(ch.name)) continue;
          var helpers = global.MeflyAddons._helpers;
          var name = helpers.cleanName(String(ch.name || '').replace(/\[[^\]]*\]/g, ''));
          if (helpers.isJunkName(ch.name, name)) continue;
          seenUrl[u] = 1;
          all.push({
            id: 'iptvorg:' + (ch.tvgId || name + ':' + u.substring(0, 40)),
            name: name,
            logo: ch.logo || '',
            type: 'channel',
            addonBase: 'iptv-org',
            addonName: 'iptv-org (grátis)',
            group: (function () {
              var g = helpers.cleanName(ch.group);
              return (g && !/^undefined$/i.test(g)) ? g : 'iptv-org';
            })(),
            url: u
          });
        }
      }).catch(function () { /* ignora fonte que falhou */ });
    })).then(function () { return all; });
  }

  /**
   * Busca todos os canais (addons habilitados + iptv-org).
   * Retorna { channels: [], errors: [] }
   */
  function loadAll(addons) {
    var enabled = (addons || []).filter(function (a) { return a && a.enabled !== false; });
    var errors = [];

    var addonPromises = enabled.map(function (a) {
      return global.MeflyAddons.fetchChannelsFromAddon(a)
        .then(function (list) { return list; })
        .catch(function (e) {
          errors.push({ addon: a.name, error: e.message });
          return [];
        });
    });

    return Promise.all([Promise.all(addonPromises), loadIPTVorg()])
      .then(function (results) {
        var fromAddons = [].concat.apply([], results[0]);
        var fromIptv = results[1];
        var all = fromAddons.concat(fromIptv);

        // Dedup por id (mantém o primeiro)
        var seen = {};
        var dedup = [];
        for (var i = 0; i < all.length; i++) {
          var c = all[i];
          if (seen[c.id]) continue;
          seen[c.id] = 1;
          dedup.push(c);
        }

        // Ordena por nome (pt-BR)
        dedup.sort(function (x, y) {
          var a = (x.name || '').toLowerCase();
          var b = (y.name || '').toLowerCase();
          if (a < b) return -1;
          if (a > b) return 1;
          return 0;
        });

        return { channels: dedup, errors: errors };
      });
  }

  global.MeflyChannels = { loadAll: loadAll };
})(window);

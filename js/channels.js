/**
 * channels.js — Agrega canais de TODOS os addons habilitados + iptv-org (URLs diretas).
 * Mesmo padrão do app desktop (routes/channels.js), só que rodando 100% no cliente.
 */
(function (global) {
  'use strict';

  // Fontes FIXAS e CONFIÁVEIS (GitHub Pages do iptv-org não cai e tem CORS aberto).
  // São URLs DIRETAS de HLS que tocam sem precisar resolver via addon.
  // Núcleo em português + categorias úteis. Cada fonte carrega independente:
  // se uma cair, as outras seguem (nunca trava o app inteiro).
  var IPTV_ORG_M3U = [
    'https://iptv-org.github.io/iptv/countries/br.m3u',         // Brasil
    'https://iptv-org.github.io/iptv/languages/por.m3u',        // Português (BR + PT + outros)
    'https://iptv-org.github.io/iptv/countries/pt.m3u',         // Portugal
    'https://iptv-org.github.io/iptv/categories/news.m3u',      // Notícias (CNN, BBC, Euronews…)
    'https://iptv-org.github.io/iptv/categories/sports.m3u',    // Esportes
    'https://iptv-org.github.io/iptv/categories/movies.m3u',    // Filmes
    'https://iptv-org.github.io/iptv/categories/kids.m3u',      // Infantil
    'https://iptv-org.github.io/iptv/categories/music.m3u',     // Música
    'https://iptv-org.github.io/iptv/categories/documentary.m3u' // Documentários
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

  // Rótulo amigável da categoria, derivado da URL da lista (fallback de grupo).
  function categoryFromUrl(url) {
    var m = url.match(/\/(countries|languages|categories)\/([a-z0-9_-]+)\.m3u/i);
    if (!m) return 'TV';
    return translateGroup(m[2]) || 'TV';
  }

  // Traduz/normaliza nomes de grupo (vêm em inglês das listas de categoria do
  // iptv-org, às vezes compostos com ";"). Deixa em português e sem duplicidade.
  var GROUP_MAP = {
    news: 'Notícias', sports: 'Esportes', sport: 'Esportes',
    movies: 'Filmes', movie: 'Filmes', kids: 'Infantil', children: 'Infantil',
    music: 'Música', documentary: 'Documentários', documentaries: 'Documentários',
    entertainment: 'Entretenimento', general: 'Geral', religious: 'Religioso',
    animation: 'Animação', series: 'Séries', comedy: 'Comédia', culture: 'Cultura',
    education: 'Educação', business: 'Negócios', cooking: 'Culinária',
    lifestyle: 'Estilo de Vida', science: 'Ciência', travel: 'Viagem',
    weather: 'Clima', auto: 'Automóveis', family: 'Família', legislative: 'Legislativo',
    outdoor: 'Aventura', relax: 'Relax', shop: 'Compras', shopping: 'Compras',
    classic: 'Clássicos', br: 'Brasil', pt: 'Portugal', por: 'Português', undefined: 'TV'
  };
  function translateGroup(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    // Grupo composto "Animation;Kids" → pega o 1º pedaço
    s = s.split(/[;,/|]/)[0].trim();
    var low = s.toLowerCase();
    if (GROUP_MAP[low]) return GROUP_MAP[low];
    // Capitaliza a 1ª letra pra grupos já em PT (ex.: "globo sudeste")
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function loadOneM3U(url, seenUrl, accum) {
    var fallbackGroup = categoryFromUrl(url);
    return fetchText(url, 22000).then(function (text) {
      var list = parseM3U(text);
      var helpers = global.MeflyAddons._helpers;
      for (var i = 0; i < list.length; i++) {
        var ch = list[i];
        var u = String(ch.url || '').trim();
        if (!/^https?:\/\//i.test(u)) continue;
        if (seenUrl[u]) continue;               // mesmo stream em 2 listas = 1 só
        if (/\[\s*not\s*24\/7\s*\]/i.test(ch.name)) continue;
        var name = helpers.cleanName(String(ch.name || '').replace(/\[[^\]]*\]/g, ''));
        if (helpers.isJunkName(ch.name, name)) continue;
        seenUrl[u] = 1;
        var g = helpers.cleanName(ch.group);
        g = (!g || /^undefined$/i.test(g)) ? fallbackGroup : translateGroup(g);
        accum.push({
          id: 'iptvorg:' + (ch.tvgId || name + ':' + u.substring(0, 40)),
          name: name,
          logo: ch.logo || '',
          type: 'channel',
          addonBase: 'iptv-org',
          addonName: 'iptv-org',
          group: g,
          url: u
        });
      }
    }).catch(function () { /* fonte que falhou: ignora, as outras seguem */ });
  }

  function loadIPTVorg() {
    var all = [];
    var seenUrl = {};
    // Cada lista carrega de forma independente; uma falha não derruba as demais.
    return Promise.all(IPTV_ORG_M3U.map(function (url) {
      return loadOneM3U(url, seenUrl, all);
    })).then(function () { return all; });
  }

  /**
   * Busca todos os canais (addons habilitados + iptv-org).
   * Retorna { channels: [], errors: [] }
   */
  // Limita o tempo de uma promise; se estourar, resolve com o fallback (não trava).
  function withTimeout(promise, ms, fallback) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(fallback); } }, ms);
      promise.then(function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } })
             .catch(function () { if (!done) { done = true; clearTimeout(t); resolve(fallback); } });
    });
  }

  function loadAll(addons) {
    var enabled = (addons || []).filter(function (a) { return a && a.enabled !== false; });
    var errors = [];

    // Addons (Frost etc.) têm timeout CURTO: se estiverem dormindo/fora do ar,
    // o app NÃO espera — o iptv-org (base sólida) carrega normalmente.
    var addonPromises = enabled.map(function (a) {
      return withTimeout(
        global.MeflyAddons.fetchChannelsFromAddon(a).catch(function (e) {
          errors.push({ addon: a.name, error: e.message }); return [];
        }),
        12000, // 12s máx por addon; passou disso, segue sem ele
        []
      );
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

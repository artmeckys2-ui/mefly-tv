/**
 * channels.js — Agrega canais de TODOS os addons habilitados + iptv-org (URLs diretas).
 * Mesmo padrão do app desktop (routes/channels.js), só que rodando 100% no cliente.
 */
(function (global) {
  'use strict';

  // Fontes FIXAS e CONFIÁVEIS (GitHub Pages do iptv-org não cai e tem CORS aberto).
  // Divididas em 2 grupos:
  //  - CORE: listas majoritariamente BR/PT → entram TODOS os canais (24/7).
  //  - EXTRA: listas globais (esportes, filmes…) → entram SÓ os canais brasileiros
  //    (tvg-id .br). Assim pego variedade BR sem despejar milhares de estrangeiros.
  var SRC_CORE = [
    'https://iptv-org.github.io/iptv/countries/br.m3u',   // Brasil
    'https://iptv-org.github.io/iptv/languages/por.m3u',  // Português (BR + PT)
    'https://iptv-org.github.io/iptv/countries/pt.m3u'    // Portugal
  ];
  var SRC_EXTRA_BR_ONLY = [
    'https://iptv-org.github.io/iptv/categories/news.m3u',
    'https://iptv-org.github.io/iptv/categories/sports.m3u',
    'https://iptv-org.github.io/iptv/categories/movies.m3u',
    'https://iptv-org.github.io/iptv/categories/kids.m3u',
    'https://iptv-org.github.io/iptv/categories/music.m3u',
    'https://iptv-org.github.io/iptv/categories/documentary.m3u',
    'https://iptv-org.github.io/iptv/categories/entertainment.m3u',
    'https://iptv-org.github.io/iptv/categories/general.m3u',
    'https://iptv-org.github.io/iptv/categories/education.m3u',
    'https://iptv-org.github.io/iptv/categories/culture.m3u',
    'https://iptv-org.github.io/iptv/categories/travel.m3u',
    'https://iptv-org.github.io/iptv/categories/lifestyle.m3u',
    'https://iptv-org.github.io/iptv/categories/science.m3u',
    'https://iptv-org.github.io/iptv/categories/weather.m3u',
    'https://iptv-org.github.io/iptv/categories/animation.m3u',
    'https://iptv-org.github.io/iptv/categories/series.m3u',
    'https://iptv-org.github.io/iptv/categories/classic.m3u',
    'https://iptv-org.github.io/iptv/categories/religious.m3u'
  ];

  // Pega o título do canal no #EXTINF: tudo depois da PRIMEIRA vírgula que
  // estiver FORA de aspas. Assim atributos com vírgula (ex.: user-agent
  // "Mozilla/5.0 (KHTML, like Gecko)...") não quebram mais o nome.
  function extractTitle(extinf) {
    var inQuote = false;
    for (var i = 0; i < extinf.length; i++) {
      var ch = extinf.charAt(i);
      if (ch === '"') inQuote = !inQuote;
      else if (ch === ',' && !inQuote) return extinf.substring(i + 1).trim();
    }
    return '';
  }

  // Nome que claramente é lixo (user-agent, código, URL) — descarta o canal.
  function isGarbageName(name) {
    return /(?:mozilla|applewebkit|khtml|gecko|chrome\/|safari\/|http[s]?:\/\/|user-agent|<\/?\w+>)/i.test(name);
  }

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
        var name = extractTitle(l);
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

  // Detecta canal brasileiro: tvg-id ".br" OU grupo/nome com marcas BR.
  function isBrazilian(ch) {
    if (/\.br\b/i.test(ch.tvgId || '')) return true;
    var blob = ((ch.group || '') + ' ' + (ch.name || '')).toLowerCase();
    // marcas comuns de canais BR nas listas
    return /\b(brasil|brazil|brazu|globo|sbt|record|band|globonews|cultura|rede tv|redetv|cnn brasil|jovem pan)\b/.test(blob);
  }

  function loadOneM3U(url, seenUrl, accum, brOnly) {
    var fallbackGroup = categoryFromUrl(url);
    return fetchText(url, 22000).then(function (text) {
      var list = parseM3U(text);
      var helpers = global.MeflyAddons._helpers;
      for (var i = 0; i < list.length; i++) {
        var ch = list[i];
        var u = String(ch.url || '').trim();
        if (!/^https?:\/\//i.test(u)) continue;
        if (seenUrl[u]) continue;                       // mesmo stream em 2 listas = 1 só
        if (/\[\s*not\s*24\/7\s*\]/i.test(ch.name)) continue;   // corta "não 24/7" (mortos)
        if (isGarbageName(ch.name)) continue;           // corta nome-lixo (user-agent/código)
        if (brOnly && !isBrazilian(ch)) continue;       // lista global: só entra BR
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
    // CORE = todos os canais (já são BR/PT). EXTRA = só os brasileiros.
    var jobs = SRC_CORE.map(function (url) { return loadOneM3U(url, seenUrl, all, false); })
      .concat(SRC_EXTRA_BR_ONLY.map(function (url) { return loadOneM3U(url, seenUrl, all, true); }));
    return Promise.all(jobs).then(function () { return all; });
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

  // Carrega as listas M3U do PRÓPRIO usuário. Sem filtro BR — é a lista dele,
  // entra tudo (24/7). Cada uma carrega independente e com timeout.
  function loadUserM3U() {
    var lists = (global.MeflyStorage.loadM3ULists && global.MeflyStorage.loadM3ULists()) || [];
    if (!lists.length) return Promise.resolve([]);
    var all = [];
    var seenUrl = {};
    return Promise.all(lists.map(function (entry) {
      return fetchText(entry.url, 22000).then(function (text) {
        var parsed = parseM3U(text);
        var helpers = global.MeflyAddons._helpers;
        for (var i = 0; i < parsed.length; i++) {
          var ch = parsed[i];
          var u = String(ch.url || '').trim();
          if (!/^https?:\/\//i.test(u) || seenUrl[u]) continue;
          var name = helpers.cleanName(String(ch.name || '').replace(/\[[^\]]*\]/g, ''));
          if (helpers.isJunkName(ch.name, name)) continue;
          seenUrl[u] = 1;
          var g = helpers.cleanName(ch.group);
          all.push({
            id: 'm3u:' + (ch.tvgId || name + ':' + u.substring(0, 40)),
            name: name, logo: ch.logo || '', type: 'channel',
            addonBase: 'm3u', addonName: entry.name || 'Minha lista',
            group: (g && !/^undefined$/i.test(g)) ? translateGroup(g) : (entry.name || 'Minha lista'),
            url: u
          });
        }
      }).catch(function () { /* lista que falhou: ignora */ });
    })).then(function () { return all; });
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

    return Promise.all([Promise.all(addonPromises), loadIPTVorg(), loadUserM3U()])
      .then(function (results) {
        var fromAddons = [].concat.apply([], results[0]);
        var fromIptv = results[1];
        var fromM3U = results[2];
        // DEBUG: log counts por origem para diagnóstico de fontes
        try { console.log('[channels] fromAddons=', (fromAddons && fromAddons.length) || 0,
                          'fromIptv=', (fromIptv && fromIptv.length) || 0,
                          'fromM3U=', (fromM3U && fromM3U.length) || 0); } catch (_) {}
        var all = fromM3U.concat(fromAddons).concat(fromIptv);

        // Dedup por id (mantém o primeiro)
        var seen = {};
        var dedup = [];
        for (var i = 0; i < all.length; i++) {
          var c = all[i];
          if (seen[c.id]) continue;
          seen[c.id] = 1;
          dedup.push(c);
        }

        // CURADORIA: tira o lixo de qualidade.
        var curated = curateByQuality(dedup);

        // Ordena por nome (pt-BR)
        curated.sort(function (x, y) {
          var a = (x.name || '').toLowerCase();
          var b = (y.name || '').toLowerCase();
          if (a < b) return -1;
          if (a > b) return 1;
          return 0;
        });

        return { channels: curated, errors: errors };
      });
  }

  // Extrai a resolução do nome ("Globo (1080p)" -> 1080). 0 se não achar.
  function qualityOf(name) {
    var m = String(name || '').match(/(\d{3,4})\s*p/i);
    return m ? parseInt(m[1], 10) : 0;
  }
  // Nome-base sem a marca de qualidade, pra agrupar variantes do mesmo canal.
  function baseName(name) {
    return String(name || '')
      .replace(/\(?\s*\d{3,4}\s*p\s*\)?/ig, '')   // tira (1080p), 720p…
      .replace(/\b(fhd|uhd|hd|sd|4k)\b/ig, '')     // tira marcas FHD/HD/SD
      .replace(/[\s\-_|.]+$/,'').replace(/^[\s\-_|.]+/,'')
      .replace(/\s{2,}/g, ' ')
      .trim().toLowerCase();
  }

  /**
   * Curadoria de qualidade:
   *  - Agrupa canais pelo nome-base (Globo 480p, Globo 1080p = mesmo grupo).
   *  - Mantém só a MELHOR qualidade de cada grupo.
   *  - Canais identificados com resolução < 480p são cortados (lixo 240/360p).
   *  - Canais sem resolução no nome são mantidos (não dá pra saber, melhor manter).
   *  - Anexa .quality (número) pra UI mostrar um selo HD.
   */
  function curateByQuality(list) {
    var MIN_Q = 480; // mantém 480p+ (inclui SD melhor que 360/240)
    var groups = {};
    var keep = [];

    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var q = qualityOf(c.name);
      c.quality = q;
      // Corta resolução baixa conhecida
      if (q > 0 && q < MIN_Q) continue;

      var key = baseName(c.name) + '|' + (c.group || '');
      // Canais de listas do PRÓPRIO usuário (m3u:) nunca são dedupados/cortados
      // — é a lista dele, respeita do jeito que veio.
      if (String(c.id).indexOf('m3u:') === 0) { keep.push(c); continue; }

      if (!key || key === '|') { keep.push(c); continue; }
      var prev = groups[key];
      if (!prev) {
        groups[key] = c;
        keep.push(c);
      } else if (q > (prev.quality || 0)) {
        // achou versão melhor: substitui a anterior na lista
        var idx = keep.indexOf(prev);
        if (idx >= 0) keep[idx] = c;
        groups[key] = c;
      }
      // senão (q <= prev): descarta a duplicata pior
    }
    return keep;
  }

  global.MeflyChannels = { loadAll: loadAll };
})(window);

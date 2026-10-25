/**
 * channels.js — Agrega canais dos addons habilitados + listas M3U do usuário.
 * Mesmo padrão do app desktop (routes/channels.js), só que rodando 100% no cliente.
 */
(function (global) {
  'use strict';

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
    var helpers = global.MeflyAddons && global.MeflyAddons._helpers;
    if (!helpers || !helpers.isSafeRemoteUrl || !helpers.isSafeRemoteUrl(url)) {
      return Promise.reject(new Error('URL remota bloqueada'));
    }
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

  // Carrega as listas M3U do PRÓPRIO usuário. Sem filtro BR — é a lista dele,
  // entra tudo (24/7). Cada uma carrega independente e com timeout.
  function loadUserM3U() {
    var lists = (global.MeflyStorage.loadM3ULists && global.MeflyStorage.loadM3ULists()) || [];
    lists = lists.filter(function (entry) { return entry && entry.enabled !== false; });
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
          if (!helpers.isSafeRemoteUrl(u) || seenUrl[u]) continue;
          var name = helpers.cleanName(String(ch.name || '').replace(/\[[^\]]*\]/g, ''));
          if (helpers.isJunkName(ch.name, name)) continue;
          seenUrl[u] = 1;
          var g = helpers.cleanName(ch.group);
          all.push({
            id: 'm3u:' + (ch.tvgId || name + ':' + u.substring(0, 40)),
            name: name, logo: helpers.safeImgUrl(ch.logo), type: 'channel',
            sourceId: 'm3u:' + entry.url,
            addonBase: 'm3u', addonName: entry.name || 'Minha lista',
            group: (g && !/^undefined$/i.test(g)) ? translateGroup(g) : (entry.name || 'Minha lista'),
            url: u
          });
        }
      }).catch(function () { /* lista que falhou: ignora */ });
    })).then(function () { return all; });
  }

  function loadAll(addons, onUpdate) {
    var enabled = (addons || []).filter(function (a) { return a && a.enabled !== false; });
    var errors = [];
    var recovered = []; // nomes dos addons que voltaram via auto-refresh
    var fromAddons = [];
    var fromM3U = [];
    var curatedCache = null;
    var totalSources = enabled.length + 1;
    var completedSources = 0;

    function snapshot(complete) {
      if (curatedCache === null) {
        curatedCache = curateByQuality(fromM3U.concat(fromAddons));
        curatedCache.sort(function (x, y) {
          var a = (x.name || '').toLowerCase();
          var b = (y.name || '').toLowerCase();
          var aInitial = a.trim().charAt(0).replace(/[à-å]/g, 'a').replace(/ç/g, 'c')
            .replace(/[è-ë]/g, 'e').replace(/[ì-ï]/g, 'i').replace(/[ò-ö]/g, 'o').replace(/[ù-ü]/g, 'u');
          var bInitial = b.trim().charAt(0).replace(/[à-å]/g, 'a').replace(/ç/g, 'c')
            .replace(/[è-ë]/g, 'e').replace(/[ì-ï]/g, 'i').replace(/[ò-ö]/g, 'o').replace(/[ù-ü]/g, 'u');
          var aIsLetter = /^[a-z]$/.test(aInitial);
          var bIsLetter = /^[a-z]$/.test(bInitial);
          if (aIsLetter !== bIsLetter) return aIsLetter ? -1 : 1;
          if (a < b) return -1;
          if (a > b) return 1;
          return 0;
        });
      }
      var curated = curatedCache;
      var sourceRatio = totalSources ? (completedSources / totalSources) : 0;
      var channelRatio = Math.min(1, (curated.length || 0) / 1800);
      var weightedProgress = (sourceRatio * 0.78) + (channelRatio * 0.22);
      var rawProgress = complete ? 100 : Math.max(0, Math.min(95, Math.round(weightedProgress * 100)));
      return {
        channels: curated,
        errors: errors.slice(),
        recovered: recovered.slice(),
        complete: complete,
        progress: rawProgress
      };
    }

    function publishPartial() {
      if (typeof onUpdate !== 'function') return;
      try { onUpdate(snapshot(false)); } catch (error) { console.warn('[channels update]', error); }
    }

    publishPartial();
    var addonPromises = enabled.map(function (addon) {
      return tryAddonWithRetry(addon, function () { recovered.push(addon.name); }, errors)
        .then(function (list) {
          fromAddons = fromAddons.concat(list || []);
          curatedCache = null;
          completedSources++;
          publishPartial();
        });
    });
    var jobs = [Promise.all(addonPromises)];
    jobs.push(loadUserM3U().then(function (list) {
      fromM3U = list || [];
      curatedCache = null;
      completedSources++;
      publishPartial();
    }));

    return Promise.all(jobs).then(function () {
      try { console.log('[channels] fromAddons=', fromAddons.length,
                        'fromM3U=', fromM3U.length,
                        'recovered=', recovered); } catch (_) {}
      return Promise.resolve(global.MeflyStorage.seedKnownChannels
        ? global.MeflyStorage.seedKnownChannels(curatedCache || fromM3U.concat(fromAddons))
        : false).then(function () {
        return snapshot(true);
      });
    });
  }

  /**
   * Busca canais do addon. Se vier vazio (cold start, manifest stale, etc.),
   * re-baixa o manifest com timeout longo e tenta UMA vez mais.
   * Se a 2ª tentativa der canais, chama onRecover (pra UI mostrar toast).
   */
  function tryAddonWithRetry(addon, onRecover, errors) {
    return global.MeflyAddons.fetchChannelsFromAddon(addon)
      .catch(function (e) {
        if (errors) errors.push({ addon: addon.name, error: e.message });
        return [];
      })
      .then(function (list) {
        if (list && list.length > 0) return list;
        // Vazio: pode ser cold-start ou addon migrado. Re-baixa manifest e retenta.
        return global.MeflyAddons.refreshManifest(addon).then(function (changed) {
          // Se algo mudou no manifest, persiste no storage pra próxima carga
          if (changed && global.MeflyStorage && global.MeflyStorage.saveAddons) {
            try {
              var stored = global.MeflyStorage.loadAddons();
              for (var i = 0; i < stored.length; i++) {
                if (stored[i].id === addon.id) {
                  // mescla campos atualizados (preserva enabled e qualquer extra)
                  stored[i].name = addon.name;
                  stored[i].version = addon.version;
                  stored[i].description = addon.description;
                  stored[i].logo = addon.logo;
                  stored[i].baseUrl = addon.baseUrl;
                  stored[i].catalogs = addon.catalogs;
                  stored[i].types = addon.types;
                  break;
                }
              }
              global.MeflyStorage.saveAddons(stored);
            } catch (_) {}
          }
          return global.MeflyAddons.fetchChannelsFromAddon(addon);
        }).then(function (list2) {
          if (list2 && list2.length > 0) {
            if (typeof onRecover === 'function') onRecover();
            return list2;
          }
          return [];
        }).catch(function () { return []; });
      });
  }

  // Extrai a resolução do nome ("Globo (1080p)" -> 1080). 0 se não achar.
  function qualityOf(name) {
    var m = String(name || '').match(/(\d{3,4})\s*p/i);
    return m ? parseInt(m[1], 10) : 0;
  }

  function shouldDropCountryTitle(name) {
    var text = String(name || '').trim();
    if (!text) return false;
    var low = text.toLowerCase();

    // Mantém só conteúdo em português/BR; elimina nomes de canais estrangeiros.
    var hasForeignCountry = /\b(?:argentina|chile|uruguay|paraguay|colombia|peru|ecuador|bolivia|venezuela|mexico|usa|united states|canada|spain|portugal|france|germany|italy|england|australia|brazilian|argentino|chileno|uruguayo|paraguayo|colombiano|peruano|ecuatoriano|boliviano|venezolano|mexicano|american|canadian|spanish|french|german|italian|english|australian)\b/i.test(low);
    if (!hasForeignCountry) return false;

    // Preserve conteúdos brasileiros por contexto esportivo ou menção explícita ao Brasil.
    var hasBrazilContext = /\b(?:brasil|brazil|sele\u00e7\u00e3o brasileira|copa do brasil|campeonato brasileiro|brasileir[oa]|brasileiro|brasileira|\bbr\b|\bpt-br\b)\b/i.test(low);
    if (hasBrazilContext) return false;

    // Se o nome tiver futebol/torneio + país estranho, ainda pode ser canal brasileiro.
    var hasBrazilSportContext = /\b(?:jogo|partida|futebol|campeonato|libertadores|copa|mundial|brasileirao|serie a|sele\u00e7\u00e3o|bandeiras?\s*de|x\s*argentina|x\s*chile|x\s*uruguai|x\s*peru)\b/i.test(low);
    if (hasBrazilSportContext && /\b(?:brasil|brazil)\b/i.test(low)) return false;

    return true;
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

  /** Deduplica dentro de cada fonte pelo nome-base e mantém a maior resolução. */
  function curateByQuality(list) {
    var keep = [];
    var indexBySourceAndName = {};

    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var q = qualityOf(c.name);
      c.quality = q;

      if (global.MeflyStorage.isBlockedChannel(c)) continue;

      // Filtra países estrangeiros no título do canal no app padrão, mas preserva
      // jogos/menções de Brasil em contextos esportivos brasileiros.
      if (c.addonBase !== 'm3u' && shouldDropCountryTitle(c.name)) continue;

      // Canais M3U do usuário não passam pelo filtro de país; duplicatas só são
      // removidas dentro da própria lista, sem cruzar com outras fontes.
      var nameKey = baseName(c.name).replace(/[^a-z0-9]/g, '');
      if (!nameKey) continue;
      var sourceKey = c.sourceId || c.addonBase || c.addonName || 'unknown';
      var key = sourceKey + '|' + nameKey;
      if (Object.prototype.hasOwnProperty.call(indexBySourceAndName, key)) {
        var existingIndex = indexBySourceAndName[key];
        if (q > keep[existingIndex].quality) keep[existingIndex] = c;
        continue;
      }
      indexBySourceAndName[key] = keep.length;
      keep.push(c);
    }
    return keep;
  }

  global.MeflyChannels = { loadAll: loadAll };
})(window);

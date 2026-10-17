/**
 * addons.js — Cliente Stremio Addon Protocol.
 * Busca manifest, catálogos (tv/channel) e streams direto do navegador da TV.
 * Os addons Stremio têm CORS aberto (precisam, pra Stremio Web funcionar).
 */
(function (global) {
  'use strict';

  function normalizeBase(url) {
    if (!url) return '';
    return String(url)
      .replace(/\/manifest\.json$/i, '')
      .replace(/\/+$/, '');
  }

  function isSafeRemoteUrl(raw) {
    var url;
    try { url = new URL(String(raw)); } catch (_) { return false; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;

    var host = (url.hostname || '').toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '');
    if (!host || host === 'localhost' || /\.localhost$/.test(host) ||
        /\.(local|internal|home\.arpa)$/.test(host)) return false;

    if (host.indexOf(':') !== -1) {
      if (host === '::' || host === '::1' || /^::ffff:/i.test(host)) return false;
      var prefix = parseInt(host.split(':')[0] || '0', 16);
      if (prefix < 0x2000 || prefix > 0x3fff ||
          /^2001:(?:0?db8|0?10|0?20|0?2)(?::|$)/.test(host)) return false;
      return true;
    }

    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
      var octets = host.split('.');
      var first = Number(octets[0]);
      var second = Number(octets[1]);
      var third = Number(octets[2]);
      if (first === 0 || first === 10 || first === 127 || first >= 224 ||
          (first === 169 && second === 254) ||
          (first === 172 && second >= 16 && second <= 31) ||
          (first === 192 && (second === 0 || second === 168)) ||
          (first === 192 && second === 88 && third === 99) ||
          (first === 198 && second === 18) ||
          (first === 198 && second === 51 && third === 100) ||
          (first === 203 && second === 0 && third === 113) ||
          (first === 100 && second >= 64 && second <= 127)) return false;
    }
    return true;
  }

  // ===== SANITIZAÇÃO DE MANIFEST =====
  // Defense-in-depth: o manifest é JSON inerte (não executa nada), mas se o
  // domínio do addon for sequestrado ele pode mandar valores estranhos que
  // sujam a UI ou geram requests pesadas. Cortamos tudo pra tamanho/forma sãos.
  var MAX_STR = 500;
  var MAX_DESC = 2000;
  var MAX_CATALOGS = 50;
  var MAX_TYPES = 20;
  var MAX_MANIFEST_BYTES = 1024 * 1024; // 1MB — manifest real tem ~1-5 KB

  // String segura pra exibir/usar: limita tamanho, remove caracteres de controle.
  function safeStr(v, max) {
    if (v == null) return '';
    var s = String(v).replace(/[\x00-\x1F\x7F-\x9F]/g, ''); // remove caracteres de controle
    if (s.length > (max || MAX_STR)) s = s.slice(0, max || MAX_STR);
    return s;
  }
  // URL segura pra src de imagem: só HTTP/HTTPS/data:image. Bloqueia javascript:,
  // file:, etc. (em navegadores modernos `javascript:` em <img> não executa, mas
  // bloqueamos por defesa em profundidade — pode ter TV antiga com bug).
  function safeImgUrl(v) {
    if (!v) return '';
    var s = String(v).trim();
    if (s.length > 2048) return '';
    if (/^https?:\/\//i.test(s) && isSafeRemoteUrl(s)) return s;
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(s)) return s;
    return '';
  }
  function safeCatalogs(arr) {
    if (!Array.isArray(arr)) return [];
    var out = [];
    for (var i = 0; i < arr.length && out.length < MAX_CATALOGS; i++) {
      var c = arr[i];
      if (!c || typeof c !== 'object') continue;
      // Só guarda os campos que de fato usamos
      out.push({
        id: safeStr(c.id, 200),
        type: safeStr(c.type, 50),
        name: safeStr(c.name, 200)
      });
    }
    return out;
  }
  function safeTypes(arr) {
    if (!Array.isArray(arr)) return [];
    var out = [];
    for (var i = 0; i < arr.length && out.length < MAX_TYPES; i++) {
      out.push(safeStr(arr[i], 50));
    }
    return out;
  }
  /**
   * Aplica TODAS as proteções no manifest cru recebido do servidor.
   * Retorna {ok, manifest, error}: se ok=false, o manifest é descartado.
   */
  function sanitizeManifest(raw, opts) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'manifest não é objeto' };
    if (!raw.id || typeof raw.id !== 'string') return { ok: false, error: 'manifest sem id' };
    // ID é só letras/dígitos/.-_ (formato namespace estilo "com.frostview")
    if (raw.id.length > 200 || /[^A-Za-z0-9._\-]/.test(raw.id)) {
      return { ok: false, error: 'id do manifest inválido' };
    }
    // Se o caller exige um ID específico (refresh), valida que bate
    if (opts && opts.expectedId && raw.id !== opts.expectedId) {
      return { ok: false, error: 'id mudou: esperava "' + opts.expectedId + '", recebi "' + raw.id + '"' };
    }
    return {
      ok: true,
      manifest: {
        id: raw.id,
        name: safeStr(raw.name || raw.id, MAX_STR),
        version: safeStr(raw.version, 80),
        description: safeStr(raw.description, MAX_DESC),
        logo: safeImgUrl(raw.logo),
        types: safeTypes(raw.types),
        catalogs: safeCatalogs(raw.catalogs)
      }
    };
  }

  function fetchJSON(url, timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    if (!isSafeRemoteUrl(url)) return Promise.reject(new Error('URL remota bloqueada'));
    return new Promise(function (resolve, reject) {
      var controller;
      var timer = setTimeout(function () {
        try { controller && controller.abort(); } catch (_) {}
        reject(new Error('timeout'));
      }, timeoutMs);

      try {
        if (typeof AbortController !== 'undefined') controller = new AbortController();
      } catch (_) {}

      var opts = { method: 'GET', headers: { 'Accept': 'application/json' }, redirect: 'error' };
      if (controller) opts.signal = controller.signal;

      fetch(url, opts).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        // Limita tamanho do payload pra evitar manifest "balão" (DoS).
        // Lemos como texto, checamos bytes, e só aí parseamos JSON.
        return r.text().then(function (text) {
          if (text.length > MAX_MANIFEST_BYTES) {
            throw new Error('manifest grande demais (' + text.length + ' bytes)');
          }
          return JSON.parse(text);
        });
      }).then(function (data) {
        clearTimeout(timer);
        if (data !== undefined) resolve(data);
      }).catch(function (err) {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function fetchJSONWithRetry(url, timeoutMs, retries, retryDelayMs) {
    var retryCount = Math.max(0, Number(retries) || 0);
    var delayMs = Math.max(0, Number(retryDelayMs) || 0);

    function attempt(remainingRetries, currentDelay) {
      return fetchJSON(url, timeoutMs).catch(function (error) {
        var statusMatch = String(error.message || '').match(/^HTTP (\d+)$/);
        var status = statusMatch ? Number(statusMatch[1]) : 0;
        var retryable = !status || status === 408 || status === 429 || status >= 500;
        if (!remainingRetries || !retryable) throw error;
        return new Promise(function (resolve) { setTimeout(resolve, currentDelay); })
          .then(function () { return attempt(remainingRetries - 1, currentDelay * 2); });
      });
    }

    return attempt(retryCount, delayMs);
  }

  /**
   * Baixa o manifest de um addon a partir da URL do manifest.json.
   * Retorna o objeto addon pronto pra salvar.
   */
  function installFromManifest(manifestUrl) {
    var url = String(manifestUrl || '').trim();
    if (!isSafeRemoteUrl(url)) {
      return Promise.reject(new Error('URL inválida ou destino local não permitido.'));
    }
    // Se o usuário colou só o domínio, adiciona /manifest.json
    if (!/\/manifest\.json(\?|$)/i.test(url)) {
      url = url.replace(/\/+$/, '') + '/manifest.json';
    }

    return fetchJSON(url, 20000).then(function (raw) {
      var s = sanitizeManifest(raw);
      if (!s.ok) throw new Error('manifest.json inválido (' + s.error + ')');
      return {
        id: s.manifest.id,
        name: s.manifest.name,
        version: s.manifest.version,
        description: s.manifest.description,
        logo: s.manifest.logo,
        manifestUrl: url,
        baseUrl: normalizeBase(url),
        types: s.manifest.types,
        catalogs: s.manifest.catalogs,
        enabled: true
      };
    });
  }

  /**
   * Busca o catálogo de TV (type: 'tv' OU 'channel') de um único addon.
   * Pagina automaticamente (skip=0,100,200...) até esgotar.
   * Retorna lista normalizada de canais.
   */
  function fetchChannelsFromAddon(addon, options) {
    if (!addon || !addon.enabled) return Promise.resolve([]);
    options = options || {};
    var manifestTimeoutMs = Number(options.manifestTimeoutMs) || 25000;
    var pageTimeoutMs = Number(options.pageTimeoutMs) || 15000;
    var retries = Math.max(0, Number(options.retries) || 0);
    var retryDelayMs = Math.max(0, Number(options.retryDelayMs) || 750);
    var requestOptions = {
      pageTimeoutMs: pageTimeoutMs,
      retries: retries,
      retryDelayMs: retryDelayMs
    };
    var base = normalizeBase(addon.baseUrl || addon.manifestUrl);
    if (!base) return Promise.resolve([]);

    // 1º busca o manifest pra saber quais catálogos de TV ele tem
    return fetchJSONWithRetry(base + '/manifest.json', manifestTimeoutMs, retries, retryDelayMs).then(function (manifest) {
      var cats = (manifest.catalogs || []).filter(function (c) {
        return c && (c.type === 'tv' || c.type === 'channel');
      });
      if (!cats.length) return [];

      var all = [];
      var catalogErrors = [];
      // Processa catálogos em série pra não estourar tudo de uma vez
      var p = Promise.resolve();
      cats.forEach(function (cat) {
        p = p.then(function () {
          return fetchCatalogPaginated(base, cat, addon, all, requestOptions);
        }).catch(function (error) {
          catalogErrors.push(error);
        });
      });
      return p.then(function () {
        if (catalogErrors.length) {
          var detail = catalogErrors[0].message || String(catalogErrors[0]);
          throw new Error(catalogErrors.length + ' catálogo(s) incompleto(s): ' + detail);
        }
        return all;
      });
    });
  }

  function fetchCatalogPaginated(base, cat, addon, accum, requestOptions) {
    var maxItems = 10000; // teto maior para addons com catálogos grandes
    var pageSize = 100;
    var pageConcurrency = 3;

    function loop(skip) {
      if (skip >= maxItems) return Promise.resolve();
      var requests = [];
      var count = Math.min(pageConcurrency, Math.ceil((maxItems - skip) / pageSize));
      for (var pageIndex = 0; pageIndex < count; pageIndex++) {
        (function (pageSkip) {
          var url = base + '/catalog/' + encodeURIComponent(cat.type) + '/' +
                    encodeURIComponent(cat.id) + (pageSkip > 0 ? '/skip=' + pageSkip : '') + '.json';
          requests.push(fetchJSONWithRetry(url, requestOptions.pageTimeoutMs, requestOptions.retries, requestOptions.retryDelayMs).catch(function (error) {
            error.catalogPage = Math.floor(pageSkip / pageSize) + 1;
            throw error;
          }));
        })(skip + pageIndex * pageSize);
      }
      return Promise.all(requests).then(function (pages) {
        var hasMore = true;
        for (var pageIndex = 0; pageIndex < pages.length; pageIndex++) {
          var metas = (pages[pageIndex] && pages[pageIndex].metas) || [];
          if (metas.length < pageSize) hasMore = false;
          for (var i = 0; i < metas.length; i++) {
            var m = metas[i];
            if (!m || !m.id) continue;
            var rawName = asStr(m.name || m.title || m.id);
            var name = cleanName(rawName);
            if (isJunkName(rawName, name)) continue;
            accum.push({
              id: asStr(m.id),
              name: name,
              logo: asStr(m.poster || m.logo || m.thumbnail || m.background || ''),
              type: asStr(m.type || cat.type) || 'channel',
              sourceId: 'addon:' + (addon.id || base),
              addonBase: base,
              addonName: addon.name,
              group: cleanName(asStr(m.genre) || asStr(m.genres) || asStr(cat.name))
            });
          }
        }
        if (hasMore) return loop(skip + pages.length * pageSize);
      });
    }
    return loop(0).catch(function (error) {
      var pageNumber = error.catalogPage || 1;
      throw new Error('Catálogo "' + (cat.name || cat.id) + '", página ' + pageNumber + ': ' + (error.message || 'falha no download'));
    });
  }

  /**
   * Resolve o stream (URL final) de um canal pedindo /stream/{type}/{id}.json ao addon.
   */
  function resolveStream(channel) {
    if (!channel) return Promise.reject(new Error('sem canal'));
    // Canal com URL direta (iptv-org) — toca na hora
    if (channel.url) return Promise.resolve(channel.url);

    var base = normalizeBase(channel.addonBase);
    if (!base) return Promise.reject(new Error('addon desconhecido'));
    var url = base + '/stream/' + encodeURIComponent(channel.type || 'channel') +
              '/' + encodeURIComponent(channel.id) + '.json';

    return fetchJSON(url, 15000).then(function (data) {
      var streams = (data && data.streams) || [];
      for (var i = 0; i < streams.length; i++) {
        var s = streams[i];
        var u = (s && (s.url || s.externalUrl)) || '';
        if (isSafeRemoteUrl(u)) return u;
      }
      throw new Error('sem stream tocável');
    });
  }

  // ===== Helpers de nome (copiado do app desktop) =====
  function asStr(v) {
    if (Array.isArray(v)) return v.length ? String(v[0]) : '';
    return v == null ? '' : String(v);
  }
  function cleanName(s) {
    return String(s == null ? '' : s)
      .replace(/[֎�]/g, ' ')
      .replace(/[•·▶◆■★☆※]+/g, ' ')
      .replace(/[_=~|]{2,}/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s\-_|=•.]+|[\s\-_|=•.]+$/g, '')
      .trim();
  }
  function isJunkName(raw, clean) {
    if (!clean) return true;
    if (/[֎�]/.test(raw)) return true;
    if (clean.replace(/[^A-Za-zÀ-ÿ0-9]/g, '').length < 2) return true;
    return false;
  }

  /**
   * Re-baixa o manifest do addon e atualiza os campos (baseUrl, name, catalogs, version)
   * IN-PLACE no objeto recebido. Usa timeout longo (30s) pra cobrir cold-start do Render
   * free tier — esse é exatamente o cenário em que o catálogo normal (12s) falha mas
   * "reinstalar manualmente" funciona, porque a tela de instalação espera mais.
   *
   * Não joga erro: se falhar, devolve false (e o app segue com a info cacheada).
   * Devolve true se algum campo mudou (sinal pra salvar no storage).
   */
  function refreshManifest(addon) {
    if (!addon || !addon.manifestUrl) return Promise.resolve(false);
    // Só HTTPS pra eliminar risco de MITM no auto-refresh (a URL original
    // já foi adicionada pelo usuário, mas reforçamos a regra).
    if (!/^https:\/\//i.test(addon.manifestUrl)) return Promise.resolve(false);

    return fetchJSON(addon.manifestUrl, 30000).then(function (raw) {
      // Sanitiza e EXIGE que o id seja o mesmo (defesa contra hijack: se o
      // domínio for sequestrado e servir outro manifest, refusamos).
      var s = sanitizeManifest(raw, { expectedId: addon.id });
      if (!s.ok) return false;
      var m = s.manifest;

      var changed = false;
      function set(k, v) { if (v !== undefined && addon[k] !== v) { addon[k] = v; changed = true; } }
      set('name', m.name || addon.name);
      set('version', m.version || addon.version);
      set('description', m.description || addon.description);
      set('logo', m.logo || addon.logo);
      var newBase = normalizeBase(addon.manifestUrl);
      set('baseUrl', newBase);
      // catalogs pode ter sido alterado pelo addon (ex.: novo catálogo de TV)
      try {
        var oldCat = JSON.stringify(addon.catalogs || []);
        var newCat = JSON.stringify(m.catalogs);
        if (oldCat !== newCat) { addon.catalogs = m.catalogs; changed = true; }
      } catch (_) {}
      addon.types = m.types;
      return changed;
    }).catch(function () { return false; });
  }

  /**
   * "Acorda" addons que possam estar dormindo (Render free tier dorme após 15min).
   * Dispara fetch dos manifests SEM esperar — usado em chamadas periódicas pra
   * manter os serviços vivos enquanto o usuário tá no app.
   */
  function warmUp(addons) {
    if (!Array.isArray(addons)) return;
    for (var i = 0; i < addons.length; i++) {
      var a = addons[i];
      if (!a || a.enabled === false || !a.manifestUrl) continue;
      if (!/^https:\/\//i.test(a.manifestUrl) || !isSafeRemoteUrl(a.manifestUrl)) continue;
      // Fire-and-forget. Não nos importamos com o resultado, só queremos
      // que a request chegue no servidor (e ele acorde, se estiver dormindo).
      try { fetch(a.manifestUrl, { method: 'GET', cache: 'no-store', redirect: 'error' }).catch(function () {}); }
      catch (_) {}
    }
  }

  global.MeflyAddons = {
    installFromManifest: installFromManifest,
    fetchChannelsFromAddon: fetchChannelsFromAddon,
    resolveStream: resolveStream,
    refreshManifest: refreshManifest,
    warmUp: warmUp,
    _helpers: { cleanName: cleanName, isJunkName: isJunkName, asStr: asStr }
  };
})(window);

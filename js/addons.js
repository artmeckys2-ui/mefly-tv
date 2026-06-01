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

  function fetchJSON(url, timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    return new Promise(function (resolve, reject) {
      var controller;
      var timer = setTimeout(function () {
        try { controller && controller.abort(); } catch (_) {}
        reject(new Error('timeout'));
      }, timeoutMs);

      try {
        if (typeof AbortController !== 'undefined') controller = new AbortController();
      } catch (_) {}

      var opts = { method: 'GET', headers: { 'Accept': 'application/json' } };
      if (controller) opts.signal = controller.signal;

      fetch(url, opts).then(function (r) {
        clearTimeout(timer);
        if (!r.ok) { reject(new Error('HTTP ' + r.status)); return; }
        return r.json();
      }).then(function (data) {
        if (data !== undefined) resolve(data);
      }).catch(function (err) {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Baixa o manifest de um addon a partir da URL do manifest.json.
   * Retorna o objeto addon pronto pra salvar.
   */
  function installFromManifest(manifestUrl) {
    var url = String(manifestUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      return Promise.reject(new Error('URL inválida. Use http:// ou https://'));
    }
    // Se o usuário colou só o domínio, adiciona /manifest.json
    if (!/\/manifest\.json(\?|$)/i.test(url)) {
      url = url.replace(/\/+$/, '') + '/manifest.json';
    }

    return fetchJSON(url, 20000).then(function (manifest) {
      if (!manifest || !manifest.id) {
        throw new Error('manifest.json inválido (sem id)');
      }
      return {
        id: manifest.id,
        name: manifest.name || manifest.id,
        version: manifest.version || '',
        description: manifest.description || '',
        logo: manifest.logo || '',
        manifestUrl: url,
        baseUrl: normalizeBase(url),
        types: manifest.types || [],
        catalogs: manifest.catalogs || [],
        enabled: true
      };
    });
  }

  /**
   * Busca o catálogo de TV (type: 'tv' OU 'channel') de um único addon.
   * Pagina automaticamente (skip=0,100,200...) até esgotar.
   * Retorna lista normalizada de canais.
   */
  function fetchChannelsFromAddon(addon) {
    if (!addon || !addon.enabled) return Promise.resolve([]);
    var base = normalizeBase(addon.baseUrl || addon.manifestUrl);
    if (!base) return Promise.resolve([]);

    // 1º busca o manifest pra saber quais catálogos de TV ele tem
    return fetchJSON(base + '/manifest.json', 25000).then(function (manifest) {
      var cats = (manifest.catalogs || []).filter(function (c) {
        return c && (c.type === 'tv' || c.type === 'channel');
      });
      if (!cats.length) return [];

      var all = [];
      // Processa catálogos em série pra não estourar tudo de uma vez
      var p = Promise.resolve();
      cats.forEach(function (cat) {
        p = p.then(function () { return fetchCatalogPaginated(base, cat, addon, all); });
      });
      return p.then(function () { return all; });
    }).catch(function () { return []; });
  }

  function fetchCatalogPaginated(base, cat, addon, accum) {
    var maxItems = 2000; // teto pra não pendurar a TV num addon mal-comportado
    var pageSize = 100;

    function loop(skip) {
      if (skip >= maxItems) return Promise.resolve();
      var extra = skip > 0 ? '/skip=' + skip : '';
      var url = base + '/catalog/' + encodeURIComponent(cat.type) + '/' +
                encodeURIComponent(cat.id) + extra + '.json';
      return fetchJSON(url, 15000).then(function (page) {
        var metas = (page && page.metas) || [];
        if (!metas.length) return; // acabou
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
            addonBase: base,
            addonName: addon.name,
            group: cleanName(asStr(m.genre) || asStr(m.genres) || asStr(cat.name))
          });
        }
        if (metas.length < pageSize) return; // última página
        return loop(skip + pageSize);
      }).catch(function () { /* pula página com erro */ });
    }
    return loop(0);
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
        if (/^https?:\/\//i.test(u)) return u;
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

  global.MeflyAddons = {
    installFromManifest: installFromManifest,
    fetchChannelsFromAddon: fetchChannelsFromAddon,
    resolveStream: resolveStream,
    _helpers: { cleanName: cleanName, isJunkName: isJunkName, asStr: asStr }
  };
})(window);

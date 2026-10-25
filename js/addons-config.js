(function (global) {
  'use strict';

  var isLocalDev = location.port === '8088' &&
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  global.MeflyPublishedAddonConfig = null;
  global.MeflyPublishedAddonConfigReady = Promise.resolve();
  if (isLocalDev) return;

  var timeout = new Promise(function (_resolve, reject) {
    setTimeout(function () { reject(new Error('Tempo esgotado ao buscar a configuração de addons.')); }, 5000);
  });
  var request = fetch('addons.json?nocache=' + Date.now(), { cache: 'no-store' }).then(function (response) {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }).then(function (config) {
    if (!config || !Array.isArray(config.addons) || !config.revision) {
      throw new Error('Configuração publicada de addons inválida.');
    }
    global.MeflyPublishedAddonConfig = config;
  });
  global.MeflyPublishedAddonConfigReady = Promise.race([request, timeout]).catch(function (error) {
    console.error('[addons config] Não foi possível carregar a lista oficial:', error && error.message || error);
  });
})(window);

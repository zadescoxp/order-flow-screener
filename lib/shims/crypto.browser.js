// Browser stand-in for Node's `crypto` module.
//
// Some Siebly SDKs (e.g. coinbase-api) import Node crypto only to sign
// requests for private, authenticated streams. This app uses public market
// data in the browser, which never signs, so these throw if ever reached.
// Aliased in next.config.ts (turbopack.resolveAlias, browser condition).
function unavailable(name) {
  return function () {
    throw new Error(`crypto.${name} is not available in the browser (public market data only)`);
  };
}

const api = {
  createHmac: unavailable("createHmac"),
  createHash: unavailable("createHash"),
  createSign: unavailable("createSign"),
  createPrivateKey: unavailable("createPrivateKey"),
  randomBytes: unavailable("randomBytes"),
};

module.exports = { ...api, default: api };

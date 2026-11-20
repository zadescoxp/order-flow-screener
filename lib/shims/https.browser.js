// Browser stand-in for Node's `https` module.
//
// The Siebly exchange SDKs (e.g. bybit-api) import `https` only to build a
// keep-alive Agent for their REST client. We use their public WebSocket
// clients in the browser, which never touch it, so an inert Agent is enough.
// Aliased in next.config.ts (turbopack.resolveAlias, browser condition).
class Agent {}

module.exports = { Agent, default: { Agent } };

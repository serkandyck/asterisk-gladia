const { getProvider } = require("./lib/provider");
const { getServer } = require("./lib/server");
const { dispatch } = require("./lib/dispatcher");

// Load environment variables from .env file
require('dotenv').config();

const glaApiKey = process.env.GLADIA_API_KEY;
const providerName = process.env.PROVIDER || 'gladia';

// Static/default configuration
const DEFAULT_PORT = 9099;

const server = getServer("ws", { port: DEFAULT_PORT });

// Prepare provider options, ensure GLADIA_API_KEY exists for Gladia
const providerOptions = {};
if (providerName === 'gladia') {
    if (!glaApiKey) {
        console.error('Error: GLADIA_API_KEY is missing. Set the environment variable GLADIA_API_KEY.');
        process.exit(1);
    }
    providerOptions.apiKey = glaApiKey;
}

// Helper for codec selection in AEAP protocol
class Codecs {
  constructor(defaultCodec) { this.selected = defaultCodec; }
  first(requested) {
    let name = Array.isArray(requested) ? requested[0] : requested;
    if (typeof name === 'object') name = name.name;
    this.selected = { ...this.selected, name };
    return this.selected;
  }
}

// Helper for language selection in AEAP protocol
class Languages {
  constructor(defaultLang) { this.selected = defaultLang; }
  first(requested) {
    const lang = Array.isArray(requested) ? requested[0] : requested;
    this.selected = lang;
    return this.selected;
  }
}

server.on("connection", (client) => {
  // Build AEAP speech session object
  const speech = {
    transport: client,
    provider: getProvider(providerName, providerOptions),
    codecs: new Codecs({ name: "ulaw", sampleRate: 8000, attributes: [] }),
    languages: new Languages("en-US"),
  };
  dispatch(speech);
});

process.on("SIGINT", () => {
    server.close();
    process.exit(0);
});

process.on("SIGTERM", () => {
    server.close();
    process.exit(0);
});

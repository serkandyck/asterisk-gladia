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

server.on("connection", (client) => {
    dispatch({
        codecs: { name: "ulaw", sampleRate: 8000, attributes: [] },
        languages: "en-US",
        transport: client,
        provider: getProvider(providerName, providerOptions),
    });
});

process.on("SIGINT", () => {
    server.close();
    process.exit(0);
});

process.on("SIGTERM", () => {
    server.close();
    process.exit(0);
});

const { getProvider } = require("./lib/provider");
const { getServer } = require("./lib/server");
const { dispatch } = require("./lib/dispatcher");

// Static/default configuration
const DEFAULT_PORT = 9099;

const server = getServer("ws", { port: DEFAULT_PORT });

server.on("connection", (client) => {
	dispatch({
		codecs: { name: "ulaw", sampleRate: 8000, attributes: [] },
		languages: "en-US",
		transport: client,
		provider: getProvider("google", argv),
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



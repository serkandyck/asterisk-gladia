const { getProvider } = require("./lib/provider");
const { getServer } = require("./lib/server");
const { dispatch } = require("./lib/dispatcher");

// Static/default configuration
const DEFAULT_PORT = 9099;

const server = getServer("ws", { port: DEFAULT_PORT });

server.on("connection", (client) => {
    /*dispatch({
        codecs: { name: "ulaw", sampleRate: 8000, attributes: [] },
        languages: "en-US",
        transport: client,
        provider: getProvider(providerName, providerOptions),
    });*/

	client.on("close", () => {
		//client.provider.end();
		console.log("Client disconnected");
	});

	client.on("message", (data, isBinary) => {
		if (isBinary) {
			//client.provider.write(data);
			console.log("Binary message received");
			console.log(data);
			return;
		}

		console.debug("message: " + data);

		let msg = JSON.parse(data);

		if (msg.hasOwnProperty('request')) {
			msg = handleRequest(client, msg);
		} else if (msg.hasOwnProperty('response')) {
			msg = handleResponse(client, msg);
		} else {
			msg = null;
		}

		if (msg) {
			sendMessage(client, msg);
		}
	});

	client.provider.on("result", (result) => {
		sendSetRequest(client, { results: [ result ] });
	});
});

function sendMessage(speech, msg) {
	speech.transport.send(JSON.stringify(msg), { binary: false });
}

function handleRequest(speech, msg) {
	const handlers = {
		"get": handleGetRequest,
		"set": handleSetRequest,
		"setup": handleSetRequest,
	};

	let response = { response: msg.request, id: msg.id };

	try {
		handlers[msg.request](speech, msg, response);
	} catch (e) {
		handleError(e, response);
	}

	return response;
}

function handleError(e, msg) {
	msg.error_msg = e.message;
}

function handleResponse(speech, msg) {
	return null; // TODO
}

process.on("SIGINT", () => {
    server.close();
    process.exit(0);
});

process.on("SIGTERM", () => {
    server.close();
    process.exit(0);
});

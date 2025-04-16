const EventEmitter = require("events");
const { WebSocketServer } = require("ws");

const DEFAULT_PORT = 9099;

class WSServer extends EventEmitter {
	
	constructor(options) {
		super();

		this.port = options && options.port || DEFAULT_PORT;

		this.ws = new WebSocketServer({
			port: this.port,
			clientTracking: true,
		});

		this.ws.on("listening", () => {
			console.info("Server on port '" + this.port + "': started listening");
		});

		this.ws.on("close", () => {
			console.info("Server on port '" + this.port + "': stopped listening");
		});

		this.ws.on("error", (error) => {
			console.error(error);
		});

		this.ws.on("connection", (client) => {
			console.info("Server on port '" + this.port + "': client connected");
			this.emit("connection", client);
		});
	}

	close() {
		for (let client of this.ws.clients) {
			console.log("WSServer: close client");
			client.close();
		}

		this.ws.close((error) => {
			console.log("error " + error);
		});
	}
}

function getServer(name, options) {
	if (name == "ws") {
		return new WSServer(options);
	}

	throw new Error("Unsupported server type '" + name + "'");
}

module.exports = {
	getServer,
}

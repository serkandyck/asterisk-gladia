const { Writable } = require('stream');
const speech = require('@google-cloud/speech');
const WebSocket = require('ws');
const fetch = require('node-fetch');

const DEFAULT_ENCODING = "MULAW";
const DEFAULT_SAMPLE_RATE = 8000;
const DEFAULT_LANGUAGE = "en-US";
const DEFAULT_RESTART_TIME = 10; // in seconds
const DEFAULT_MAX_RESULTS = 100;

class GoogleProvider extends Writable {

    /* Mapped encodings supported by Google */
    static encodings = {
        ulaw: "MULAW",
        slin16: "LINEAR16",
        opus: "OGG Opus",
    };

    /* Languages this provider supports  */
    static languages = [
        "en-US",
    ];

    constructor(options) {
        super();

        this.config = {
            encoding: DEFAULT_ENCODING,
            sampleRateHertz: DEFAULT_SAMPLE_RATE,
            languageCode: DEFAULT_LANGUAGE,
        };

        this.restartTimer = null;
        this.restartTimeout = options && options.restartTime || DEFAULT_RESTART_TIME;
        this.maxResults = options && options.maxResults || DEFAULT_MAX_RESULTS;

        this.results = [];
        this.recognizeStream = null;
    }

    _construct(callback) {
        this.client = new speech.SpeechClient();

        callback();
    }

    _write(chunk, encoding, callback) {
        if (this.recognizeStream) {
            this.recognizeStream.write(chunk);
        }

        callback();
    }

    _writev(chunks, callback) {
        for (let chunk in chunks) {
            this._write(chunk, null, callback);
        }

        callback();
    }

    _final(callback) {
        this.stop();
        this.client.close();

        callback();
    }

    setConfig(config) {
        if (!config) {
            return;
        }

        let update = {};

        if (config.codec) {
            if (!(config.codec.name in GoogleProvider.encodings)) {
                throw new Error("Codec '" + config.codec.name + " 'not supported");
            }

            update.encoding = GoogleProvider.encodings[config.codec.name];
            update.sampleRateHertz = config.codec.sampleRate;
        }

        if (config.language) {
            if (!GoogleProvider.languages.includes(config.language)) {
                throw new Error("Language '" + config.language + " 'not supported");
            }

            update.languageCode = config.language;
        }

        this.config = {...this.config, ...update};
    }

    start(config) {
        if (this.recognizeStream) {
            return; // Already started
        }

        this.setConfig(config);
        config = this.config;

        const request = {
            config,
            interimResults: true,
        };

        this.recognizeStream = this.client
            .streamingRecognize(request)
            .on('error', (e) => {
                console.error("GoogleProvider: " + e + " - ending stream");
                this.end();
            })
            .on('data', (response) => {
                if (response.results[0] && response.results[0].alternatives[0]) {
                    if (response.results[0].alternatives[0].confidence == 0) {
                        return;
                    }

                    let result = {
                        text: response.results[0].alternatives[0].transcript,
                        score: Math.round(response.results[0].alternatives[0].confidence * 100),
                    };

                    console.debug("GoogleProvider: result: " + JSON.stringify(result));
                    this.emit('result', result);

                    if (this.results.length == this.maxResults) {
                        this.results.shift();
                    }

                    this.results.push(result);
                } else {
                    // stream limit reached restart?
                    console.debug("GoogleProvider: received response, but no result");
                }
            });

        if (this.restartTimeout) {
            /*
             * Google's speech engine may stop transcribing after a while,
             * so restart the recognize stream after a specified interval.
             */
            this.restartTimer = setTimeout(() => this.restart(), this.restartTimeout * 1000);
        }

        while (this.writableCorked) {
            this.uncork();
        }
    }

    stop() {
        if (this.restartTimer) {
            clearInterval(this.restartTimer);
            this.restartTimer = null;
        }

        if (!this.recognizeStream) {
            return;
        }

        this.cork(); // Buffer any incoming data

        this.recognizeStream.end();
        this.recognizeStream = null;
    }

    restart(config) {
        this.stop();
        this.start(config);
    }
}

// Gladia real-time STT provider
class GladiaProvider extends Writable {
    constructor(options) {
        super();
        this.apiKey = (options && options.apiKey) || process.env.GLADIA_API_KEY;
        if (!this.apiKey) {
            throw new Error('Gladia API key missing.');
        }
        this.config = { encoding: 'wav/pcm', sample_rate: 16000, bit_depth: 16, channels: 1 };
        this.socket = null;
    }

    async start(config) {
        this.config = { ...this.config, ...(config || {}) };
        const resp = await fetch('https://api.gladia.io/v2/live', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Gladia-Key': this.apiKey },
            body: JSON.stringify({
                encoding: this.config.encoding,
                sample_rate: this.config.sample_rate,
                bit_depth: this.config.bit_depth,
                channels: this.config.channels,
            }),
        });
        if (!resp.ok) {
            throw new Error(`Gladia init failed: ${resp.status}`);
        }
        const { url } = await resp.json();
        this.socket = new WebSocket(url);
        this.socket.on('message', data => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'transcript' && msg.data.is_final) {
                this.emit('result', { text: msg.data.utterance.text, score: msg.data.utterance.confidence });
            }
        });
    }

    _write(chunk, encoding, callback) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(chunk);
        }
        callback();
    }

    _final(callback) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type: 'stop_recording' }));
            this.socket.close(1000);
        }
        callback();
    }

    restart(config) {
        this._final(() => this.start(config));
    }
}

function getProvider(name, options) {
    if (name === 'gladia') {
        return new GladiaProvider(options);
    }
    if (name === 'google') {
        return new GoogleProvider(options);
    }
    throw new Error(`Unsupported speech provider '${name}'`);
}

module.exports = {
    getProvider,
}

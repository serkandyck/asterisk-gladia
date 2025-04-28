'use strict';

const { Writable } = require('stream');
const WebSocket = require('ws');
const fetch = require('node-fetch'); // Or import dynamically if using ES Modules

const GLADIA_API_URL = 'https://api.gladia.io/v2/live';

/**
 * Speech provider that uses Gladia's Live STT API.
 *
 * @extends Writable
 */
class GladiaProvider extends Writable {
  constructor(config = {}) {
    super();
    this.config = config; // Contains logger, potentially other shared resources
    this.logger = config.logger || console;
    this.apiKey = process.env.GLADIA_API_KEY;
    this.audioConfig = null;
    this.socket = null;
    this.sessionId = null;
    this.sessionUrl = null;
    this.results = []; // Store final transcriptions

    if (!this.apiKey) {
      this.logger.error('Gladia API Key (GLADIA_API_KEY) not found in environment variables.');
      // Consider throwing an error or handling this more gracefully
      // For now, we'll let it fail later when trying to initiate
    }
  }

  /**
   * Sets the configuration for the speech recognition request.
   * Corresponds roughly to AEAP START_INPUT.
   *
   * @param {object} config - Configuration parameters.
   * @param {string} config.language - Language code (e.g., 'en-US').
   * @param {string} config.codec - Audio codec (e.g., 'slin16').
   * @param {number} config.sampleRate - Sample rate (e.g., 16000).
   */
  setConfig(config) {
    this.logger.info('GladiaProvider: Setting config', config);
    // Map Asterisk codec/sampleRate to Gladia format
    // Example mapping - needs refinement based on supported formats
    const gladiaEncodingMap = {
      'slin16': 'wav/pcm', // Assuming 16-bit linear PCM is standard WAV/PCM
      // Add other mappings as needed (e.g., ulaw, alaw -> might need Gladia support confirmation or transcoding)
    };

    const encoding = gladiaEncodingMap[config.codec];
    const sampleRate = config.sampleRate || 16000; // Default if not provided
    const bitDepth = config.codec === 'slin16' ? 16 : null; // Assuming 16 for slin16

    if (!encoding || !bitDepth) {
        this.logger.error(`GladiaProvider: Unsupported codec: ${config.codec}`);
        // Handle error - maybe emit an error event?
        this.destroy(new Error(`Unsupported codec: ${config.codec}`));
        return;
    }

    this.audioConfig = {
      encoding: encoding,
      sample_rate: sampleRate,
      bit_depth: bitDepth,
      channels: 1, // Assuming mono for now
      language: config.language || 'english', // Default or use config.language
      // Add other Gladia options here if needed
    };
    this.logger.info('GladiaProvider: Mapped audio config:', this.audioConfig);
  }

  /**
   * Starts the speech recognition stream.
   * Initiates the session with Gladia and connects the WebSocket.
   */
  async start() {
    this.logger.info('GladiaProvider: Starting stream...');
    if (!this.apiKey) {
      this.destroy(new Error('Gladia API Key is missing.'));
      return;
    }
    if (!this.audioConfig) {
        this.destroy(new Error('Audio configuration not set before starting.'));
        return;
    }

    try {
      const response = await fetch(GLADIA_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gladia-Key': this.apiKey,
        },
        body: JSON.stringify(this.audioConfig),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`GladiaProvider: Failed to initiate session - ${response.status}: ${errorText}`);
        this.destroy(new Error(`Gladia API Error (${response.status}): ${errorText || response.statusText}`));
        return;
      }

      const { id, url } = await response.json();
      this.sessionId = id;
      this.sessionUrl = url;
      this.logger.info(`GladiaProvider: Session initiated. ID: ${this.sessionId}, URL: ${this.sessionUrl}`);

      this._connectWebSocket();

    } catch (error) {
      this.logger.error('GladiaProvider: Error initiating session:', error);
      this.destroy(error);
    }
  }

  _connectWebSocket() {
    this.socket = new WebSocket(this.sessionUrl);

    this.socket.on('open', () => {
      this.logger.info('GladiaProvider: WebSocket connected.');
      // Ready to receive audio chunks via _write
      this.emit('ready'); // Signal that we are ready for data
    });

    this.socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        // this.logger.debug('GladiaProvider: Received message:', message);

        if (message.type === 'transcript' && message.data) {
          const transcriptData = message.data;
          // PRD: Forward the *final* transcription... back to the dispatcher
          if (transcriptData.is_final) {
            const result = {
              transcript: transcriptData.utterance?.text || '',
              confidence: transcriptData.utterance?.confidence || 1.0, // Gladia might not provide confidence per utterance
              final: true
            };
            this.logger.info(`GladiaProvider: Final transcript received: "${result.transcript}"`);
            this.results.push(result); // Store final results
            this.emit('result', result);
          } else {
            // Handle interim results if needed (currently ignored per PRD)
            // this.logger.debug(`GladiaProvider: Interim transcript: "${transcriptData.utterance?.text}"`);
          }
        }
        // Handle other message types if necessary (e.g., 'audio_processing', 'error')
        else if (message.type === 'error') {
            this.logger.error('GladiaProvider: Received error message:', message.data);
            // Decide if this is fatal - might need more specific error handling
            this.destroy(new Error(`Gladia WebSocket Error: ${message.data?.message || 'Unknown error'}`));
        }
      } catch (error) {
        this.logger.error('GladiaProvider: Error processing WebSocket message:', error);
      }
    });

    this.socket.on('error', (error) => {
      this.logger.error('GladiaProvider: WebSocket error:', error);
      this.destroy(error); // Treat WebSocket errors as fatal for the stream
    });

    this.socket.on('close', (code, reason) => {
      this.logger.info(`GladiaProvider: WebSocket closed. Code: ${code}, Reason: ${reason?.toString()}`);
      this.socket = null;
      // If closed unexpectedly (not code 1000), might indicate an issue
      if (code !== 1000) {
        this.destroy(new Error(`WebSocket closed unexpectedly: ${code} - ${reason?.toString()}`));
      }
      // Stream might end naturally here after STOP_INPUT leads to close(1000)
      // Writable stream 'finish' event should handle final cleanup
    });
  }

  /**
   * Handles incoming audio chunks.
   *
   * @param {Buffer} chunk - Audio data chunk.
   * @param {string} encoding - Encoding (ignored).
   * @param {function} callback - Callback to signal processing completion.
   * @private
   */
  _write(chunk, encoding, callback) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      // Send audio chunk as binary
      this.socket.send(chunk, (error) => {
        if (error) {
          this.logger.error('GladiaProvider: Error sending audio chunk:', error);
          return callback(error);
        }
        // this.logger.debug(`GladiaProvider: Sent ${chunk.length} bytes of audio.`);
        callback();
      });
    } else {
      this.logger.warn('GladiaProvider: WebSocket not open, dropping audio chunk.');
      // Indicate we processed it, even though dropped, to not block the stream
      // Or potentially buffer if necessary and feasible
      callback();
    }
  }

  /**
   * Called when all audio chunks have been written.
   * Sends the stop_recording message to Gladia.
   *
   * @param {function} callback - Callback to signal finalization.
   * @private
   */
  _final(callback) {
    this.logger.info('GladiaProvider: Finalizing stream...');
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.logger.info('GladiaProvider: Sending stop_recording message.');
      this.socket.send(JSON.stringify({ type: 'stop_recording' }), (error) => {
        if (error) {
          this.logger.error('GladiaProvider: Error sending stop_recording:', error);
          return callback(error);
        }
        // Don't close the socket immediately; wait for Gladia to process and close (code 1000)
        callback();
      });
    } else {
      this.logger.info('GladiaProvider: WebSocket not open or already closing during finalization.');
      callback(); // Nothing more to do
    }
  }

  /**
   * Destroys the stream and cleans up resources.
   *
   * @param {Error|null} error - Optional error that caused destruction.
   * @param {function} callback - Callback function.
   * @private
   */
  _destroy(error, callback) {
      this.logger.info(`GladiaProvider: Destroying stream... ${error ? `Error: ${error.message}` : ''}`);
      if (this.socket) {
          // Attempt graceful closure if possible, otherwise terminate
          if (this.socket.readyState === WebSocket.OPEN) {
              this.socket.close(1000, 'Client stream destroyed');
          } else if (this.socket.readyState !== WebSocket.CLOSED) {
              this.socket.terminate();
          }
          this.socket = null;
      }
      this.audioConfig = null;
      this.sessionId = null;
      this.sessionUrl = null;
      // Clear results?
      // this.results = [];
      callback(error);
  }

  /**
   * Restarts the stream (not directly supported by Gladia Live in the same way as Google).
   * This might require initiating a new session.
   * For now, logs a warning.
   */
  restart() {
    this.logger.warn('GladiaProvider: restart() called, but Gladia Live might require a new session. Re-initiating is not implemented here.');
    // Potential implementation: Clean up old session, call start() again?
    // This needs careful thought regarding state management.
  }

  /**
   * Ends the stream (handled by _final and _destroy).
   */
  end() {
    this.logger.info('GladiaProvider: end() called.');
    super.end();
  }
}

module.exports = GladiaProvider;

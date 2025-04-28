# PRD: Gladia Live Speech-to-Text Provider Implementation

**Version:** 1.0
**Date:** 2025-04-28

## 1. Introduction

This document outlines the requirements for integrating Gladia's Live Speech-to-Text (STT) service as an alternative provider within the AEAP Speech-to-Text application. This will allow users to choose between the existing Google Cloud STT and Gladia STT based on their needs.

## 2. Goals

*   Enable the use of Gladia Live STT for real-time transcription initiated by Asterisk via AEAP.
*   Provide users with a choice of STT providers.
*   Maintain the existing architecture and AEAP interface consistency.
*   Configure the provider selection and API key via environment variables.

## 3. Background

The AEAP Speech-to-Text application currently acts as a bridge between Asterisk and Google Cloud STT using the AEAP protocol over WebSockets. Gladia offers a similar real-time STT service, also utilizing WebSockets after an initial REST API call for session setup. Integrating Gladia requires adding a new "Speech Provider" module that interacts with the Gladia API.

## 4. User Stories

*   **As an administrator,** I want to select Gladia as the STT provider by setting the `PROVIDER` environment variable to `gladia`.
*   **As an administrator,** I want to configure the application with my Gladia API key using the `GLADIA_API_KEY` environment variable.
*   **As an Asterisk user,** when speech recognition is invoked and Gladia is configured, I want the system to stream audio to Gladia via the AEAP application.
*   **As an Asterisk user,** I want to receive the final transcription text from Gladia back into my Asterisk context via the AEAP response.

## 5. Requirements

### 5.1. Functional Requirements

*   **Provider Selection:** The application must check the `PROVIDER` environment variable at startup. If set to `gladia`, it should instantiate and use the `GladiaSpeechProvider`.
*   **Configuration:**
    *   The Gladia API Key must be read from the `GLADIA_API_KEY` environment variable.
    *   Appropriate error handling must be implemented if the API key is missing when Gladia is selected.
*   **Gladia API Integration (`GladiaSpeechProvider` Module):**
    *   **Session Initiation:** Implement logic to make a `POST` request to the Gladia `/v2/live` endpoint upon receiving a new AEAP recognition request from Asterisk.
        *   Pass the `GLADIA_API_KEY` in the `X-Gladia-Key` header.
        *   Determine and send the correct audio parameters (`encoding`, `sample_rate`, `bit_depth`, `channels`) based on the information received from Asterisk in the AEAP `START_INPUT` message. A mapping from Asterisk formats (e.g., `slin16`) to Gladia formats (e.g., `wav/pcm`, 16000, 16, 1) is required.
        *   Store the returned `id` and `url` (WebSocket URL).
    *   **WebSocket Connection:** Establish a WebSocket connection to the `url` received from the initiation step.
    *   **Audio Streaming:** Forward audio chunks received from Asterisk (via the dispatcher) to the Gladia WebSocket connection (as binary data).
    *   **Transcription Handling:**
        *   Listen for incoming JSON messages on the Gladia WebSocket.
        *   Parse messages with `type: 'transcript'`.
        *   Extract the transcription text (`message.data.utterance.text`).
        *   Forward the *final* transcription (`message.data.is_final === true`) back to the dispatcher to be sent to Asterisk as an AEAP `RESULT` message.
        *   (Optional/Configurable) Handle interim results if needed.
    *   **Session Termination:**
        *   When Asterisk signals the end of input (e.g., AEAP `STOP_INPUT` or WebSocket closure), send the `{"type": "stop_recording"}` message to the Gladia WebSocket or close the WebSocket with code 1000.
        *   Handle WebSocket closure events (`close`, `error`).
*   **Error Handling:** Implement robust error handling for Gladia API calls (initiation, final results GET) and WebSocket communication (connection errors, unexpected messages, closure codes). Log errors appropriately.
*   **Provider Interface:** The new `GladiaSpeechProvider` must adhere to the existing internal interface expected by the dispatcher (e.g., methods like `startStream`, `write`, `end`, emitting `transcript` events).

### 5.2. Non-Functional Requirements

*   **Security:** The `GLADIA_API_KEY` should be handled securely, ideally loaded only from environment variables or a `.env` file.
*   **Documentation:** Update `README.md` and `.env.example` to include instructions for configuring and using the Gladia provider (`PROVIDER=gladia`, `GLADIA_API_KEY`).
*   **Dependencies:** Add necessary Node.js packages (e.g., `ws` for WebSocket client, `axios` or `node-fetch` for the initial API call if not already present).

## 6. Out of Scope

*   Implementing support for Gladia's Batch STT API.
*   Advanced Gladia features (e.g., diarization, translation) unless specifically requested later.
*   UI for configuration (configuration remains via environment variables).
*   Performance optimization beyond standard practices.

## 7. Open Questions

*   What specific Asterisk audio formats need to be mapped to Gladia encodings? (Need comprehensive list beyond common ones like slin16).
*   How should WebSocket reconnections be handled if the connection to Gladia drops mid-session? (Gladia docs state reconnection to the same URL is possible).
*   Should interim results from Gladia be sent back to Asterisk, or only final results? (Current requirement is final only).
*   Are specific language models or other Gladia configuration options needed beyond basic audio format?

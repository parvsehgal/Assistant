const WebSocket = require("ws");
const http = require("http");
const helper = require("./utils/audiofunctions.js");
const server = http.createServer();
require("dotenv").config();

const gptKey = process.env.KEY;
const wss = new WebSocket.Server({ noServer: true });

wss.on("connection", (ws) => {
  console.log("Client connected to /Assistant");

  // Message queue for messages received before gptClient is ready
  const messageQueue = [];
  let gptClientReady = false;

  // Generate a gpt ws client for our user
  const url =
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
  const gptClient = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${gptKey}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  // When gpt client gets connected to openai's WebSocket server
  gptClient.on("open", function open() {
    console.log("Connected to gpt WebSocket server.");
    gptClientReady = true;

    // Send queued messages
    while (messageQueue.length > 0) {
      const queuedMessage = messageQueue.shift();
      gptClient.send(queuedMessage);
    }

    ws.send("your gpt client is ready for u to use");
  });

  // When our gpt client gets a message from the openai server
  gptClient.on("message", (data) => {
    const parsedData = JSON.parse(data);
    console.log(parsedData.type);

    if (parsedData.type === "response.audio.delta") {
      const pcmData = helper.base64ToArrayBuffer(parsedData.delta);
      const sampleRate = 24000;
      const header = helper.createWavHeader(sampleRate, pcmData.byteLength);
      const finalAudioBuffer = helper.concatenateWavHeaderAndData(
        header,
        pcmData,
      );
      ws.send(finalAudioBuffer);
    } else {
      ws.send(JSON.stringify(parsedData));
    }
  });

  // Handle errors from gptClient
  gptClient.on("error", (error) => {
    console.error("GPT WebSocket error:", error);
    ws.send(
      JSON.stringify({
        type: "error",
        error: {
          message: "Connection to OpenAI failed",
          details: error.message,
        },
      }),
    );
  });

  // Handle gptClient closure
  gptClient.on("close", () => {
    console.log("GPT WebSocket closed");
    ws.close();
  });

  // Handle messages from the client
  ws.on("message", (message) => {
    try {
      const event = JSON.parse(message);

      // Check if gptClient is ready before sending
      if (gptClientReady && gptClient.readyState === WebSocket.OPEN) {
        gptClient.send(JSON.stringify(event));
      } else {
        // Queue the message if gptClient is not ready yet
        console.log("Queueing message until GPT client is ready");
        messageQueue.push(JSON.stringify(event));
      }
    } catch (e) {
      console.error("Error parsing message from client:", e);
      const errorEvent = {
        type: "error",
        error: {
          message: "Invalid JSON format sent to server.",
          details: e.message,
        },
      };
      ws.send(JSON.stringify(errorEvent));
    }
  });

  // Handle client disconnection
  ws.on("close", () => {
    console.log("Client disconnected");
    if (gptClient.readyState === WebSocket.OPEN) {
      gptClient.close();
    }
  });
});

// Handle upgrades to WebSocket connections
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/Assistant") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

// Start the server on port 4000
server.listen(4000, () => {
  console.log("WebSocket server is listening on ws://localhost:4000/Assistant");
});

import express from "express";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  
  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  const PORT = process.env.PORT || 3000;
  const usersByDeviceId = new Map();
  const socketToDeviceId = new Map();

  function getSessionBySocketId(socketId: string) {
    const deviceId = socketToDeviceId.get(socketId);
    return deviceId ? usersByDeviceId.get(deviceId) : null;
  }

  function detachPeer(session: any, reason: string, notifyPeer: boolean) {
    if (!session || !session.peerDeviceId) return;
    const peer = usersByDeviceId.get(session.peerDeviceId);
    const peerSocketId = session.peerSocketId;

    session.peerSocketId = null;
    session.peerDeviceId = null;
    session.state = "IDLE";

    if (peer) {
      peer.peerSocketId = null;
      peer.peerDeviceId = null;
      peer.state = "IDLE";
    }

    if (notifyPeer && peerSocketId) {
      io.to(peerSocketId).emit("SIG_PEER_LEFT", { reason });
    }
  }

  io.on("connection", (socket) => {
    console.log("New connection:", socket.id);

    socket.on("SIG_REGISTER", (payload: any = {}) => {
      const deviceId = String(payload.deviceId || "").trim();
      if (!deviceId) return;

      // Clean up old socket if same device reconnects
      const existing = usersByDeviceId.get(deviceId);
      if (existing && existing.socketId !== socket.id) {
        io.sockets.sockets.get(existing.socketId)?.disconnect();
      }

      usersByDeviceId.set(deviceId, {
        deviceId,
        socketId: socket.id,
        interests: [],
        mode: "TEXT",
        state: "IDLE",
        peerSocketId: null,
        peerDeviceId: null,
        skippedDeviceIds: new Set(),
      });
      socketToDeviceId.set(socket.id, deviceId);
      io.emit("SIG_ONLINE", { count: usersByDeviceId.size });
    });

    socket.on("SIG_FIND_PEER", (payload: any = {}) => {
      const session = getSessionBySocketId(socket.id);
      if (!session) return;

      detachPeer(session, "Next", false);
      session.mode = payload.mode === "VIDEO" ? "VIDEO" : "TEXT";
      session.interests = Array.isArray(payload.interests) ? payload.interests : [];
      session.state = "WAITING";

      // Simple Matcher
      const candidates = [...usersByDeviceId.values()].filter(c => 
        c.deviceId !== session.deviceId && 
        c.state === "WAITING" && 
        c.mode === session.mode
      );

      if (candidates.length > 0) {
        const peer = candidates[0];
        session.state = "MATCHED";
        session.peerSocketId = peer.socketId;
        session.peerDeviceId = peer.deviceId;

        peer.state = "MATCHED";
        peer.peerSocketId = socket.id;
        peer.peerDeviceId = session.deviceId;

        io.to(socket.id).emit("SIG_MATCH_FOUND", { targetSocketId: peer.socketId, initiator: true, mode: session.mode });
        io.to(peer.socketId).emit("SIG_MATCH_FOUND", { targetSocketId: socket.id, initiator: false, mode: session.mode });
      } else {
        socket.emit("SIG_WAITING");
      }
    });

    // --- THE FIX: FORCED RELAY ---
    socket.on("SIG_TEXT_MESSAGE", (payload: any = {}) => {
      const session = getSessionBySocketId(socket.id);
      console.log(`Msg from ${socket.id}. Peer: ${session?.peerSocketId}`);

      if (session?.peerSocketId) {
        // We broadcast to the specific room/socket of the peer
        io.to(session.peerSocketId).emit("SIG_TEXT_MESSAGE", { 
          text: payload.text 
        });
      }
    });

    socket.on("SIG_SKIP", () => {
      const session = getSessionBySocketId(socket.id);
      if (session) {
        detachPeer(session, "Skipped", true);
        socket.emit("SIG_PEER_LEFT"); // Reset local UI
      }
    });

    socket.on("disconnect", () => {
      const session = getSessionBySocketId(socket.id);
      if (session) {
        detachPeer(session, "Disconnected", true);
        usersByDeviceId.delete(session.deviceId);
        socketToDeviceId.delete(socket.id);
        io.emit("SIG_ONLINE", { count: usersByDeviceId.size });
      }
    });
  });

  // Serve Frontend
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));

  httpServer.listen(PORT, "0.0.0.0", () => console.log(`Server on port ${PORT}`));
}

startServer();

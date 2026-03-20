import express from "express";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Server } from "socket.io";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  
  // CORS is critical for Render
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  const PORT = process.env.PORT || 3000;
  const BLACKLIST_FILE = resolve(process.cwd(), "blacklist.json");

  const usersByDeviceId = new Map();
  const socketToDeviceId = new Map();
  let bannedDevices = loadBlacklist();

  function loadBlacklist() {
    try {
      if (!existsSync(BLACKLIST_FILE)) return new Set();
      const parsed = JSON.parse(readFileSync(BLACKLIST_FILE, "utf8"));
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch { return new Set(); }
  }

  function saveBlacklist() {
    try {
      writeFileSync(BLACKLIST_FILE, JSON.stringify([...bannedDevices]), "utf8");
    } catch (e) { console.error("Blacklist save failed:", e); }
  }

  function getSessionBySocketId(socketId: string) {
    const deviceId = socketToDeviceId.get(socketId);
    return deviceId ? usersByDeviceId.get(deviceId) : null;
  }

  function emitOnlineCount() {
    io.emit("SIG_ONLINE", { count: usersByDeviceId.size });
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

  function tryMatch(session: any) {
    if (!session || session.state !== "WAITING") return false;

    const candidates = [...usersByDeviceId.values()].filter(c => 
      c.deviceId !== session.deviceId && 
      c.state === "WAITING" && 
      c.mode === session.mode &&
      !session.skippedDeviceIds.has(c.deviceId)
    );

    if (candidates.length === 0) return false;

    // Interest matching
    let bestCandidate = candidates[0];
    let maxOverlap = 0;

    for (const c of candidates) {
      const overlap = session.interests.filter((i: string) => c.interests.includes(i)).length;
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        bestCandidate = c;
      }
    }

    session.state = "MATCHED";
    session.peerSocketId = bestCandidate.socketId;
    session.peerDeviceId = bestCandidate.deviceId;

    bestCandidate.state = "MATCHED";
    bestCandidate.peerSocketId = session.socketId;
    bestCandidate.peerDeviceId = session.deviceId;

    io.to(session.socketId).emit("SIG_MATCH_FOUND", { targetSocketId: bestCandidate.socketId, initiator: true, mode: session.mode });
    io.to(bestCandidate.socketId).emit("SIG_MATCH_FOUND", { targetSocketId: session.socketId, initiator: false, mode: session.mode });
    return true;
  }

  io.on("connection", (socket) => {
    console.log(`[CONN] Socket ${socket.id} joined`);

    socket.on("SIG_REGISTER", (payload: any = {}) => {
      const deviceId = String(payload.deviceId || "").trim();
      if (!deviceId) return;

      if (bannedDevices.has(deviceId)) {
        socket.emit("SIG_BANNED");
        return socket.disconnect();
      }

      // Cleanup old sessions for this device
      const oldSession = usersByDeviceId.get(deviceId);
      if (oldSession) {
        io.to(oldSession.socketId).emit("SIG_PEER_LEFT", { reason: "Logged in elsewhere" });
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
      emitOnlineCount();
    });

    socket.on("SIG_FIND_PEER", (payload: any = {}) => {
      const session = getSessionBySocketId(socket.id);
      if (!session) return;

      detachPeer(session, "Next", false);
      session.mode = payload.mode || "TEXT";
      session.interests = payload.interests || [];
      session.state = "WAITING";

      if (!tryMatch(session)) {
        socket.emit("SIG_WAITING");
      }
    });

    // --- CRITICAL FIX: Direct Relay ---
    socket.on("SIG_TEXT_MESSAGE", (payload: any = {}) => {
      const session = getSessionBySocketId(socket.id);
      
      if (session && session.peerSocketId) {
        console.log(`[MSG] ${socket.id} -> ${session.peerSocketId}: ${payload.text}`);
        // Use io.to() instead of fetching the socket object manually
        io.to(session.peerSocketId).emit("SIG_TEXT_MESSAGE", { 
          text: payload.text 
        });
      }
    });

    socket.on("SIG_SKIP", () => {
      const session = getSessionBySocketId(socket.id);
      if (session) {
        detachPeer(session, "Skipped", true);
        session.state = "WAITING";
        if (!tryMatch(session)) socket.emit("SIG_WAITING");
      }
    });

    socket.on("disconnect", () => {
      const deviceId = socketToDeviceId.get(socket.id);
      if (deviceId) {
        const session = usersByDeviceId.get(deviceId);
        if (session && session.socketId === socket.id) {
          detachPeer(session, "Disconnected", true);
          usersByDeviceId.delete(deviceId);
        }
        socketToDeviceId.delete(socket.id);
        emitOnlineCount();
      }
    });
  });

  // Production Build Handling
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`VibeLink Server live on port ${PORT}`);
  });
}

startServer();

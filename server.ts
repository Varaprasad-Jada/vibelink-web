import express from "express";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Server } from "socket.io";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  
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
    const peerDeviceId = session.peerDeviceId;

    session.peerSocketId = null;
    session.peerDeviceId = null;
    session.state = "IDLE";

    if (peer) {
      peer.peerSocketId = null;
      peer.peerDeviceId = null;
      peer.state = "IDLE";
    }

    if (notifyPeer && peerDeviceId) {
      // Send to the peer's permanent device room
      io.to(`room_${peerDeviceId}`).emit("SIG_PEER_LEFT", { reason });
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

    // Use Room-based targeting for the match notification too
    io.to(`room_${session.deviceId}`).emit("SIG_MATCH_FOUND", { 
      targetSocketId: bestCandidate.socketId, 
      initiator: true, 
      mode: session.mode 
    });
    
    io.to(`room_${bestCandidate.deviceId}`).emit("SIG_MATCH_FOUND", { 
      targetSocketId: session.socketId, 
      initiator: false, 
      mode: session.mode 
    });
    
    return true;
  }

  io.on("connection", (socket) => {
    console.log(`[CONN] ${socket.id}`);

    socket.on("SIG_REGISTER", (payload: any = {}) => {
      const deviceId = String(payload.deviceId || "").trim();
      if (!deviceId) return;

      if (bannedDevices.has(deviceId)) {
        socket.emit("SIG_BANNED");
        return socket.disconnect();
      }

      // Join a permanent room for this device
      socket.join(`room_${deviceId}`);

      const existing = usersByDeviceId.get(deviceId);
      usersByDeviceId.set(deviceId, {
        deviceId,
        socketId: socket.id,
        interests: existing?.interests || [],
        mode: existing?.mode || "TEXT",
        state: "IDLE",
        peerSocketId: null,
        peerDeviceId: null,
        skippedDeviceIds: existing?.skippedDeviceIds || new Set(),
      });
      
      socketToDeviceId.set(socket.id, deviceId);
      emitOnlineCount();
    });

    socket.on("SIG_FIND_PEER", (payload: any = {}) => {
      const session = getSessionBySocketId(socket.id);
      if (!session) return;

      detachPeer(session, "Next", false);
      session.mode = payload.mode || "TEXT";
      session.interests = Array.isArray(payload.interests) ? payload.interests : [];
      session.state = "WAITING";

      if (!tryMatch(session)) {
        socket.emit("SIG_WAITING");
      }
    });

    // --- THE CRITICAL FIX: ROOM-BASED DELIVERY ---
    socket.on("SIG_TEXT_MESSAGE", (payload: any = {}) => {
      const session = getSessionBySocketId(socket.id);
      
      if (session && session.peerDeviceId) {
        const targetRoom = `room_${session.peerDeviceId}`;
        console.log(`[MSG] ${session.deviceId} -> ${targetRoom}`);
        
        // Emit to the peer's device room instead of their specific socket ID
        io.to(targetRoom).emit("SIG_TEXT_MESSAGE", { 
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
        // Only delete if this is the active socket for that device
        if (session && session.socketId === socket.id) {
          detachPeer(session, "Disconnected", true);
          usersByDeviceId.delete(deviceId);
        }
        socketToDeviceId.delete(socket.id);
        emitOnlineCount();
      }
    });
  });

  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`VibeLink Server live on port ${PORT}`);
  });
}

startServer();

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
  const BLACKLIST_FILE = resolve(process.cwd(), "blacklist.json");
  const usersByDeviceId = new Map();
  const socketToDeviceId = new Map();
  const bannedDevices = loadBlacklist();

  function loadBlacklist() {
    try {
      if (!existsSync(BLACKLIST_FILE)) return new Set();
      const parsed = JSON.parse(readFileSync(BLACKLIST_FILE, "utf8"));
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch { return new Set(); }
  }

  function saveBlacklist() {
    writeFileSync(BLACKLIST_FILE, JSON.stringify([...bannedDevices], null, 2), "utf8");
  }

  function buildStats() {
    const values = [...usersByDeviceId.values()];
    return {
      ok: true,
      online: usersByDeviceId.size,
      waiting: values.filter((s) => s.state === "WAITING").length,
      matched: values.filter((s) => s.state === "MATCHED").length,
      banned: bannedDevices.size,
    };
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

    const candidates = [...usersByDeviceId.values()]
      .filter((c) => c.deviceId !== session.deviceId && c.state === "WAITING" && c.mode === session.mode)
      .filter((c) => !session.skippedDeviceIds.has(c.deviceId) && !c.skippedDeviceIds.has(session.deviceId));

    let bestCandidate = null;
    let bestOverlap = [];

    for (const candidate of candidates) {
      const overlap = session.interests.filter((i: string) => candidate.interests.includes(i));
      const compatible = overlap.length > 0 || session.interests.length === 0 || candidate.interests.length === 0;
      if (!compatible) continue;
      if (!bestCandidate || overlap.length > bestOverlap.length) {
        bestCandidate = candidate;
        bestOverlap = overlap;
      }
    }

    if (!bestCandidate) return false;

    session.state = "MATCHED";
    session.peerSocketId = bestCandidate.socketId;
    session.peerDeviceId = bestCandidate.deviceId;

    bestCandidate.state = "MATCHED";
    bestCandidate.peerSocketId = session.socketId;
    bestCandidate.peerDeviceId = session.deviceId;

    io.to(session.socketId).emit("SIG_MATCH_FOUND", {
      targetSocketId: bestCandidate.socketId,
      initiator: true,
      mode: session.mode,
      overlapInterests: bestOverlap,
    });

    io.to(bestCandidate.socketId).emit("SIG_MATCH_FOUND", {
      targetSocketId: session.socketId,
      initiator: false,
      mode: session.mode,
      overlapInterests: bestOverlap,
    });

    return true;
  }

  app.get("/api/stats", (_req, res) => res.json(buildStats()));

  io.on("connection", (socket) => {
    socket.on("SIG_REGISTER", (payload: any = {}) => {
      const deviceId = String(payload.deviceId || "").trim();
      if (!deviceId) return;
      if (bannedDevices.has(deviceId)) {
        socket.emit("SIG_BANNED");
        socket.disconnect(true);
        return;
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
      session.mode = payload.mode === "VIDEO" ? "VIDEO" : "TEXT";
      session.interests = Array.isArray(payload.interests) ? payload.interests : [];
      session.state = "WAITING";
      if (!tryMatch(session)) socket.emit("SIG_WAITING");
    });

    // FIXED RELAY LOGIC
    socket.on("SIG_TEXT_MESSAGE", (payload: any = {}) => {
      const session = getSessionBySocketId(socket.id);
      if (session?.peerDeviceId) {
        const peer = usersByDeviceId.get(session.peerDeviceId);
        if (peer?.socketId) {
          io.to(peer.socketId).emit("SIG_TEXT_MESSAGE", { text: payload.text });
        }
      }
    });

    socket.on("SIG_SKIP", () => {
      const session = getSessionBySocketId(socket.id);
      if (!session) return;
      detachPeer(session, "Skipped", true);
      session.state = "WAITING";
      tryMatch(session);
    });

    socket.on("disconnect", () => {
      const session = getSessionBySocketId(socket.id);
      if (session) {
        detachPeer(session, "Disconnected", true);
        usersByDeviceId.delete(session.deviceId);
        socketToDeviceId.delete(socket.id);
        emitOnlineCount();
      }
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => res.sendFile(path.join(process.cwd(), "dist", "index.html")));
  }

  httpServer.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
}

startServer();

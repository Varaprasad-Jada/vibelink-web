import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
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

  io.on("connection", (socket) => {
    // 1. REGISTRATION
    socket.on("SIG_REGISTER", (payload: any = {}) => {
      const deviceId = payload.deviceId;
      if (!deviceId) return;

      // FORCE the socket into a private room named after its own ID
      socket.join(deviceId); 

      usersByDeviceId.set(deviceId, {
        deviceId,
        socketId: socket.id,
        state: "IDLE",
        peerDeviceId: null,
      });
      socketToDeviceId.set(socket.id, deviceId);
      io.emit("SIG_ONLINE", { count: usersByDeviceId.size });
    });

    // 2. MATCHING
    socket.on("SIG_FIND_PEER", (payload: any = {}) => {
      const deviceId = socketToDeviceId.get(socket.id);
      const session = usersByDeviceId.get(deviceId);
      if (!session) return;

      session.state = "WAITING";
      session.mode = payload.mode || "TEXT";

      const peer = [...usersByDeviceId.values()].find(u => 
        u.deviceId !== deviceId && u.state === "WAITING" && u.mode === session.mode
      );

      if (peer) {
        session.state = "MATCHED";
        session.peerDeviceId = peer.deviceId;
        peer.state = "MATCHED";
        peer.peerDeviceId = deviceId;

        // Notify both
        io.to(socket.id).emit("SIG_MATCH_FOUND", { targetSocketId: peer.socketId, mode: session.mode });
        io.to(peer.socketId).emit("SIG_MATCH_FOUND", { targetSocketId: socket.id, mode: session.mode });
      }
    });

    // 3. THE MESSAGE RELAY (THE FIX)
    socket.on("SIG_TEXT_MESSAGE", (payload: any = {}) => {
      const deviceId = socketToDeviceId.get(socket.id);
      const session = usersByDeviceId.get(deviceId);

      if (session && session.peerDeviceId) {
        console.log(`Relaying: ${deviceId} -> ${session.peerDeviceId}`);
        
        // METHOD A: Send to the Peer's Socket directly
        const peerSession = usersByDeviceId.get(session.peerDeviceId);
        if (peerSession) {
           io.to(peerSession.socketId).emit("SIG_TEXT_MESSAGE", { text: payload.text });
        }

        // METHOD B: Backup - Send to the Peer's Device ID Room
        socket.to(session.peerDeviceId).emit("SIG_TEXT_MESSAGE", { text: payload.text });
      }
    });

    socket.on("disconnect", () => {
      const deviceId = socketToDeviceId.get(socket.id);
      if (deviceId) {
        const session = usersByDeviceId.get(deviceId);
        if (session?.peerDeviceId) {
          const peer = usersByDeviceId.get(session.peerDeviceId);
          if (peer) io.to(peer.socketId).emit("SIG_PEER_LEFT");
        }
        usersByDeviceId.delete(deviceId);
        socketToDeviceId.delete(socket.id);
        io.emit("SIG_ONLINE", { count: usersByDeviceId.size });
      }
    });
  });

  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  httpServer.listen(PORT, "0.0.0.0", () => console.log(`Server on ${PORT}`));
}

startServer();

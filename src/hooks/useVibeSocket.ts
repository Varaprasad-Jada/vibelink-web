import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

export function useVibeSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [isBanned, setIsBanned] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const deviceId = localStorage.getItem('vibelink_device_id') || uuidv4();
    localStorage.setItem('vibelink_device_id', deviceId);

    if (!socketRef.current) {
      socketRef.current = io("https://vibelink-vowy.onrender.com", {
        transports: ["websocket"],
        upgrade: false,
        secure: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      });
    }

    const socket = socketRef.current;

    socket.on('connect', () => {
      console.log("✅ Socket Connected:", socket.id);
      setIsConnected(true);
      socket.emit('SIG_REGISTER', { deviceId });
    });

    socket.on('disconnect', () => {
      console.log("❌ Socket Disconnected");
      setIsConnected(false);
    });

    socket.on('SIG_ONLINE', (data) => {
      if (data && typeof data.count === 'number') {
        setOnlineCount(data.count);
      }
    });

    socket.on('SIG_BANNED', () => setIsBanned(true));

    return () => {
      // Keep the connection alive during app state changes
    };
  }, []);

  return { 
    socket: socketRef.current, 
    onlineCount, 
    isBanned,
    isConnected 
  };
}

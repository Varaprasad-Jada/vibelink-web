import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

export function useVibeSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [isBanned, setIsBanned] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // 1. Handle Device ID
    const deviceId = localStorage.getItem('vibelink_device_id') || uuidv4();
    localStorage.setItem('vibelink_device_id', deviceId);

    // 2. Initialize Socket (Only if not already initialized)
    if (!socketRef.current) {
      socketRef.current = io("https://your-vibelink-server.onrender.com", {
        transports: ["websocket"], // Forces WebSocket to avoid polling issues
        reconnection: true,
      });
    }

    const socket = socketRef.current;

    // 3. Set up listeners
    socket.on('connect', () => {
      console.log('✅ Connected to signaling server:', socket.id);
      setIsConnected(true);
      // Register with the server immediately upon connection
      socket.emit('SIG_REGISTER', { deviceId });
    });

    socket.on('disconnect', () => {
      console.log('❌ Socket disconnected');
      setIsConnected(false);
    });

    socket.on('SIG_ONLINE', (data) => {
      if (data && typeof data.count === 'number') {
        setOnlineCount(data.count);
      }
    });

    socket.on('SIG_BANNED', () => {
      setIsBanned(true);
      socket.disconnect();
    });

    // 4. Cleanup on Unmount
    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('SIG_ONLINE');
      socket.off('SIG_BANNED');
    };
  }, []);

  return { 
    socket: socketRef.current, 
    onlineCount, 
    isBanned, 
    isConnected 
  };
}

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

export function useVibeSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [isBanned, setIsBanned] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const deviceId = localStorage.getItem('vibelink_device_id') || uuidv4();
    localStorage.setItem('vibelink_device_id', deviceId);

    const s = io("https://vibelink-vowy.onrender.com", {
      transports: ["websocket"],
      upgrade: false,
      secure: true,
      reconnection: true,
    });

    s.on('connect', () => {
      console.log("✅ Connected");
      setIsConnected(true);
      s.emit('SIG_REGISTER', { deviceId });
    });

    s.on('disconnect', () => setIsConnected(false));
    
    s.on('SIG_ONLINE', (data) => setOnlineCount(data.count));
    
    s.on('SIG_BANNED', () => setIsBanned(true));

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, []);

  return { socket, onlineCount, isBanned, isConnected };
}

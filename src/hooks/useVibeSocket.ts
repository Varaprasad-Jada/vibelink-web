import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

export function useVibeSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [isBanned, setIsBanned] = useState(false);

  useEffect(() => {
    const deviceId = localStorage.getItem('vibelink_device_id') || uuidv4();
    localStorage.setItem('vibelink_device_id', deviceId);

const socket = io("https://your-vibelink-server.onrender.com");

    newSocket.on('connect', () => {
      console.log('Connected to signaling server with ID:', newSocket.id);
      newSocket.emit('SIG_REGISTER', { deviceId });
      setSocket(newSocket);
    });

    newSocket.on('SIG_ONLINE', (data) => setOnlineCount(data.count));
    newSocket.on('SIG_BANNED', () => setIsBanned(true));

    return () => {
      newSocket.disconnect();
    };
  }, []);

  return { socket, onlineCount, isBanned };
}

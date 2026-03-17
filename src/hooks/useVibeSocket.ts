import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

export function useVibeSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [isBanned, setIsBanned] = useState(false);

  useEffect(() => {
    const deviceId = localStorage.getItem('vibelink_device_id') || uuidv4();
    localStorage.setItem('vibelink_device_id', deviceId);

const socket = io("https://vibelink-vowy.onrender.com");    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('SIG_REGISTER', { deviceId });
    });

    socket.on('SIG_ONLINE', (data) => setOnlineCount(data.count));
    socket.on('SIG_BANNED', () => setIsBanned(true));

    return () => {
      socket.disconnect();
    };
  }, []);

  return { socket: socketRef.current, onlineCount, isBanned };
}

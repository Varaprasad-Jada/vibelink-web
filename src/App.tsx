import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Video, 
  MessageSquare, 
  X, 
  Plus, 
  SkipForward, 
  Send, 
  ShieldAlert, 
  Users,
  AlertTriangle,
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff
} from 'lucide-react';
import { useVibeSocket } from './hooks/useVibeSocket';
import { useWebRTC } from './hooks/useWebRTC';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type AppState = 'LANDING' | 'MATCHING' | 'CHAT';
type Mode = 'TEXT' | 'VIDEO';

interface Message {
  id: string;
  text: string;
  isMe: boolean;
}
// ... (Your imports remain exactly the same)

export default function App() {
  const { socket, onlineCount, isBanned } = useVibeSocket();
  const [appState, setAppState] = useState<AppState>('LANDING');
  const [mode, setMode] = useState<Mode>('TEXT');
  const [interests, setInterests] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [remoteVideoOff, setRemoteVideoOff] = useState(false);

  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { startCall, handleSdp, handleIce, cleanup: cleanupRTC } = useWebRTC(socket, setRemoteStream);

  useEffect(() => {
    if (!socket) return;

    // Handle incoming messages
    socket.on('SIG_TEXT_MESSAGE', (data: { text: string }) => {
      setMessages(prev => [...prev, { id: Date.now().toString(), text: data.text, isMe: false }]);
    });

    socket.on('SIG_MATCH_FOUND', async (data) => {
      setAppState('CHAT');
      setRemoteVideoOff(false);
      setMessages([{ id: 'system', text: 'Connected to stranger!', isMe: false }]);

      if (data.mode === 'VIDEO') {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
        if (data.initiator) await startCall(data.targetSocketId, stream);
      }
    });

    socket.on('SIG_VIDEO_STATE_CHANGE', (data) => setRemoteVideoOff(data.isVideoOff));
    socket.on('SIG_SDP', (data) => handleSdp(data.fromSocketId, data.description));
    socket.on('SIG_ICE', (data) => handleIce(data.candidate));
    socket.on('SIG_PEER_LEFT', () => {
      resetChat();
      setAppState('MATCHING');
      socket.emit('SIG_FIND_PEER', { mode, interests });
    });

    return () => {
      socket.off('SIG_TEXT_MESSAGE');
      socket.off('SIG_MATCH_FOUND');
      socket.off('SIG_PEER_LEFT');
    };
  }, [socket, mode, interests]);

  const sendMessage = () => {
    if (!inputText.trim() || !socket) return;
    socket.emit('SIG_TEXT_MESSAGE', { text: inputText });
    setMessages(prev => [...prev, { id: Date.now().toString(), text: inputText, isMe: true }]);
    setInputText('');
  };

  const resetChat = () => {
    setMessages([]);
    setRemoteStream(null);
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    setLocalStream(null);
    cleanupRTC();
  };

  // ... (The rest of your JSX and helper functions remain the same)
  // Ensure the button for sending calls sendMessage()
}

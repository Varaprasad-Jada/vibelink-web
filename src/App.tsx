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
// ... keep your imports the same ...

export default function App() {
  const { socket, onlineCount, isBanned } = useVibeSocket();
  const [appState, setAppState] = useState<AppState>('LANDING');
  // ... existing states ...
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [remoteVideoOff, setRemoteVideoOff] = useState(false); // NEW STATE

  // ... existing refs and useWebRTC hook ...

  useEffect(() => {
    if (!socket) return;

    socket.on('SIG_MATCH_FOUND', async (data) => {
      setRemoteVideoOff(false); // Reset remote video state on new match
      setPeerSocketId(data.targetSocketId);
      setAppState('CHAT');
      // ... existing match logic ...
    });

    // NEW: Listen for the stranger toggling their camera
    socket.on('SIG_VIDEO_STATE_CHANGE', (data: { isVideoOff: boolean }) => {
      setRemoteVideoOff(data.isVideoOff);
    });

    socket.on('SIG_SDP', (data) => handleSdp(data.fromSocketId, data.description));
    socket.on('SIG_ICE', (data) => handleIce(data.candidate));
    socket.on('SIG_TEXT_MESSAGE', (data) => {
      setMessages(prev => [...prev, { id: Date.now().toString(), text: data.text, isMe: false }]);
    });

    socket.on('SIG_PEER_LEFT', () => {
      resetChat();
      setAppState('MATCHING');
      socket.emit('SIG_FIND_PEER', { mode, interests });
    });

    return () => {
      socket.off('SIG_MATCH_FOUND');
      socket.off('SIG_SDP');
      socket.off('SIG_ICE');
      socket.off('SIG_TEXT_MESSAGE');
      socket.off('SIG_PEER_LEFT');
      socket.off('SIG_VIDEO_STATE_CHANGE'); // Cleanup
    };
  }, [socket, mode, interests]);

  // UPDATED: Function to handle video toggle
  const toggleVideo = () => {
    const nextVideoState = !isVideoOff;
    setIsVideoOff(nextVideoState);

    // 1. Physically disable the camera tracks so no data is sent
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !nextVideoState;
      });
    }

    // 2. Notify the stranger via socket
    socket?.emit('SIG_VIDEO_STATE_CHANGE', { isVideoOff: nextVideoState });
  };

  // UPDATED: Function to handle mute toggle
  const toggleMute = () => {
    const nextMuteState = !isMuted;
    setIsMuted(nextMuteState);
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !nextMuteState;
      });
    }
  };

  // ... (resetChat, startMatching, handleSkip, etc. stay the same) ...

  // FIND THE VIDEO SECTION IN YOUR JSX AND REPLACE WITH THIS:
  return (
    // ... Landing and Matching stay the same ...
    
    {appState === 'CHAT' && (
      <motion.div key="chat" /* ... */>
        {/* ... Header stays the same ... */}

        <main className="flex-1 relative flex flex-col overflow-hidden">
          {mode === 'VIDEO' ? (
            <div className="absolute inset-0 bg-slate-900">
              {/* Remote Video */}
              <video 
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className={cn("w-full h-full object-cover", remoteVideoOff && "opacity-0")}
              />
              
              {/* NEW: Remote Video Placeholder */}
              {remoteVideoOff && (
                <div className="absolute inset-0 flex items-center justify-center flex-col gap-2 bg-slate-950">
                   <VideoOff className="w-16 h-16 text-slate-700" />
                   <p className="text-slate-500 font-medium">Stranger paused video</p>
                </div>
              )}

              {!remoteStream && !remoteVideoOff && (
                <div className="absolute inset-0 flex items-center justify-center flex-col gap-4">
                  <div className="w-16 h-16 rounded-full border-4 border-blue-600 border-t-transparent animate-spin"></div>
                  <p className="text-slate-400 font-medium">Connecting video...</p>
                </div>
              )}

              {/* Local Preview */}
              <motion.div drag /* ... */ className="absolute top-4 right-4 w-32 aspect-[3/4] rounded-2xl overflow-hidden border-2 border-blue-600 shadow-2xl z-40 bg-slate-800">
                <video 
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={cn("w-full h-full object-cover", isVideoOff && "hidden")}
                />
                {isVideoOff && (
                  <div className="w-full h-full flex items-center justify-center bg-slate-800">
                    <VideoOff className="w-8 h-8 text-slate-600" />
                  </div>
                )}
              </motion.div>

              {/* Video Controls - UPDATED with toggle functions */}
              <div className="absolute bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-4 z-50">
                <button 
                  onClick={toggleMute}
                  className={cn(
                    "w-12 h-12 rounded-full flex items-center justify-center transition-all",
                    isMuted ? "bg-red-500 text-white" : "bg-white/10 backdrop-blur-md text-white hover:bg-white/20"
                  )}
                >
                  {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
                <button 
                  onClick={toggleVideo}
                  className={cn(
                    "w-12 h-12 rounded-full flex items-center justify-center transition-all",
                    isVideoOff ? "bg-red-500 text-white" : "bg-white/10 backdrop-blur-md text-white hover:bg-white/20"
                  )}
                >
                  {isVideoOff ? <VideoOff className="w-5 h-5" /> : <VideoIcon className="w-5 h-5" />}
                </button>
              </div>
            </div>
          ) : (
             // ... Text Chat JSX stays the same ...
          )}
          {/* ... Skip button and Footer stay the same ... */}
        </main>
      </motion.div>
    )}
  );
}

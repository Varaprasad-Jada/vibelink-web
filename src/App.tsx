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

export default function App() {
  const { socket, onlineCount, isBanned } = useVibeSocket();
  const [appState, setAppState] = useState<AppState>('LANDING');
  const [mode, setMode] = useState<Mode>('TEXT');
  const [interests, setInterests] = useState<string[]>([]);
  const [interestInput, setInterestInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peerSocketId, setPeerSocketId] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [remoteVideoOff, setRemoteVideoOff] = useState(false);

  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { startCall, handleSdp, handleIce, cleanup: cleanupRTC } = useWebRTC(socket, (stream) => {
    setRemoteStream(stream);
  });

  // 1. SIGNALING & PEER MANAGEMENT
  useEffect(() => {
    if (!socket) return;

    socket.on('SIG_MATCH_FOUND', async (data) => {
      setRemoteVideoOff(false);
      setPeerSocketId(data.targetSocketId);
      setAppState('CHAT');
      setMessages([{ id: 'system', text: 'You are now chatting with a stranger!', isMe: false }]);

      if (data.mode === 'VIDEO') {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          setLocalStream(stream);
          if (data.initiator) {
            await startCall(data.targetSocketId, stream);
          }
        } catch (err) {
          console.error('Media access denied', err);
          socket.emit('SIG_SKIP');
        }
      }
    });

    socket.on('SIG_SDP', (data) => handleSdp(data.fromSocketId, data.description));
    socket.on('SIG_ICE', (data) => handleIce(data.candidate));
    
    socket.on('SIG_VIDEO_STATE_CHANGE', (data: { isVideoOff: boolean }) => {
      setRemoteVideoOff(data.isVideoOff);
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
      socket.off('SIG_PEER_LEFT');
      socket.off('SIG_VIDEO_STATE_CHANGE');
    };
  }, [socket, mode, interests]);

  // 2. STABLE MESSAGE LISTENER
  useEffect(() => {
    if (!socket) return;

    const handleIncomingMessage = (data: { text: string }) => {
      setMessages(prev => [...prev, { 
        id: Date.now().toString(), 
        text: data.text, 
        isMe: false 
      }]);
    };

    socket.on('SIG_TEXT_MESSAGE', handleIncomingMessage);
    
    return () => {
      socket.off('SIG_TEXT_MESSAGE', handleIncomingMessage);
    };
  }, [socket]);

  // 3. MEDIA STREAM BINDING
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // 4. AUTO SCROLL
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ACTIONS
  const toggleVideo = () => {
    const nextVideoState = !isVideoOff;
    setIsVideoOff(nextVideoState);
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !nextVideoState;
      });
    }
    socket?.emit('SIG_VIDEO_STATE_CHANGE', { isVideoOff: nextVideoState });
  };

  const toggleMute = () => {
    const nextMuteState = !isMuted;
    setIsMuted(nextMuteState);
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !nextMuteState;
      });
    }
  };

  const resetChat = () => {
    setMessages([]);
    setRemoteStream(null);
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      setLocalStream(null);
    }
    cleanupRTC();
    setPeerSocketId(null);
    setIsVideoOff(false);
    setIsMuted(false);
    setRemoteVideoOff(false);
  };

  const startMatching = (selectedMode: Mode) => {
    setMode(selectedMode);
    setAppState('MATCHING');
    socket?.emit('SIG_FIND_PEER', { mode: selectedMode, interests });
  };

  const handleSkip = () => {
    socket?.emit('SIG_SKIP');
    resetChat();
    setAppState('MATCHING');
  };

  const sendMessage = () => {
    if (!inputText.trim() || !socket) return;
    socket.emit('SIG_TEXT_MESSAGE', { text: inputText });
    setMessages(prev => [...prev, { id: Date.now().toString(), text: inputText, isMe: true }]);
    setInputText('');
  };

  const addInterest = () => {
    if (interestInput.trim() && !interests.includes(interestInput.trim().toLowerCase())) {
      setInterests([...interests, interestInput.trim().toLowerCase()]);
      setInterestInput('');
    }
  };

  if (isBanned) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <ShieldAlert className="w-20 h-20 text-red-500 mx-auto mb-6" />
          <h1 className="text-3xl font-bold text-white mb-4">Access Denied</h1>
          <p className="text-slate-400">Your device has been banned for violating our community guidelines.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-blue-500/30">
      <AnimatePresence mode="wait">
        {appState === 'LANDING' && (
          <motion.div 
            key="landing"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="max-w-md mx-auto px-6 py-12 flex flex-col min-h-screen"
          >
            <header className="flex items-center justify-between mb-12">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/20">
                  <Video className="w-6 h-6 text-white" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight">VibeLink</h1>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800">
                <Users className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-bold">{onlineCount.toLocaleString()} online</span>
              </div>
            </header>

            <main className="flex-1 flex flex-col justify-center">
              <h2 className="text-4xl font-extrabold mb-4 leading-tight">
                Connect with <span className="text-blue-500">Strangers</span> Instantly.
              </h2>
              <p className="text-slate-400 text-lg mb-10">
                Add your interests to find people who vibe with you.
              </p>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-bold text-slate-500 uppercase tracking-widest mb-3 ml-1">
                    Your Interests
                  </label>
                  <div className="relative">
                    <input 
                      type="text"
                      value={interestInput}
                      onChange={(e) => setInterestInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addInterest()}
                      placeholder="Gaming, Coding, Music..."
                      className="w-full h-14 bg-slate-900 border-2 border-slate-800 rounded-2xl px-5 pr-14 focus:border-blue-600 focus:ring-0 transition-all placeholder:text-slate-600"
                    />
                    <button 
                      onClick={addInterest}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center hover:bg-blue-500 transition-colors"
                    >
                      <Plus className="w-6 h-6" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    {interests.map(interest => (
                      <span 
                        key={interest}
                        className="px-4 py-1.5 rounded-full bg-blue-600/10 border border-blue-600/30 text-blue-500 text-sm font-medium flex items-center gap-2"
                      >
                        #{interest}
                        <X 
                          className="w-3 h-3 cursor-pointer hover:text-blue-400" 
                          onClick={() => setInterests(interests.filter(i => i !== interest))}
                        />
                      </span>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 pt-4">
                  <button 
                    onClick={() => startMatching('VIDEO')}
                    className="flex items-center justify-center gap-3 w-full h-16 rounded-2xl bg-blue-600 font-bold text-lg shadow-lg shadow-blue-600/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                  >
                    <Video className="w-6 h-6" />
                    Video Chat
                  </button>
                  <button 
                    onClick={() => startMatching('TEXT')}
                    className="flex items-center justify-center gap-3 w-full h-16 rounded-2xl bg-slate-900 border-2 border-slate-800 font-bold text-lg hover:bg-slate-800 transition-all"
                  >
                    <MessageSquare className="w-6 h-6 text-blue-500" />
                    Text Chat
                  </button>
                </div>
              </div>
            </main>
          </motion.div>
        )}

        {appState === 'MATCHING' && (
          <motion.div 
            key="matching"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="min-h-screen flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="relative w-32 h-32 mb-8">
              <div className="absolute inset-0 rounded-full border-4 border-blue-600/20"></div>
              <div className="absolute inset-0 rounded-full border-4 border-blue-600 border-t-transparent animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                {mode === 'VIDEO' ? <Video className="w-10 h-10 text-blue-500" /> : <MessageSquare className="w-10 h-10 text-blue-500" />}
              </div>
            </div>
            <h2 className="text-2xl font-bold mb-2">Finding a stranger...</h2>
            <p className="text-slate-400 mb-8">Matching based on your interests</p>
            <button 
              onClick={() => setAppState('LANDING')}
              className="px-8 py-3 rounded-full bg-slate-900 border border-slate-800 font-bold text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </motion.div>
        )}

        {appState === 'CHAT' && (
          <motion.div 
            key="chat"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="h-screen flex flex-col overflow-hidden bg-black"
          >
            <header className="flex items-center justify-between p-4 bg-slate-950/80 backdrop-blur-md border-b border-slate-800 z-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center">
                  <Users className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">Stranger</h3>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                    <span className="text-[10px] font-bold text-green-500 uppercase tracking-widest">Connected</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="p-2 rounded-lg bg-slate-900 text-slate-400 hover:text-red-500 transition-colors">
                  <AlertTriangle className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => { resetChat(); setAppState('LANDING'); }}
                  className="p-2 rounded-lg bg-slate-900 text-slate-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </header>

            <main className="flex-1 relative flex flex-col overflow-hidden">
              {mode === 'VIDEO' ? (
                <div className="absolute inset-0 bg-slate-900">
                  <video 
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className={cn("w-full h-full object-cover transition-opacity duration-300", (remoteVideoOff || !remoteStream) ? "opacity-0" : "opacity-100")}
                  />
                  
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

                  <motion.div 
                    drag
                    dragConstraints={{ left: -100, right: 100, top: -100, bottom: 100 }}
                    className="absolute top-4 right-4 w-32 aspect-[3/4] rounded-2xl overflow-hidden border-2 border-blue-600 shadow-2xl z-40 bg-slate-800"
                  >
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
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950">
                  {messages.map(msg => (
                    <div 
                      key={msg.id}
                      className={cn(
                        "flex flex-col max-w-[80%]",
                        msg.isMe ? "ml-auto items-end" : "items-start"
                      )}
                    >
                      <div className={cn(
                        "px-4 py-2.5 rounded-2xl text-sm font-medium",
                        msg.id === 'system' ? "bg-slate-900 text-slate-500 text-center w-full max-w-none" :
                        msg.isMe ? "bg-blue-600 text-white rounded-tr-none" : "bg-slate-900 text-slate-100 rounded-tl-none border border-slate-800"
                      )}>
                        {msg.text}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              )}

              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50">
                <button 
                  onClick={handleSkip}
                  className="flex items-center gap-2 px-8 py-4 rounded-full bg-blue-600 text-white font-bold shadow-xl shadow-blue-600/30 hover:bg-blue-500 active:scale-95 transition-all"
                >
                  <SkipForward className="w-5 h-5" />
                  NEXT STRANGER
                </button>
              </div>
            </main>

            <footer className="p-4 bg-slate-950 border-t border-slate-800 pb-8">
              <div className="flex items-center gap-2 max-w-2xl mx-auto">
                <input 
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Type a message..."
                  className="flex-1 h-12 bg-slate-900 border-none rounded-2xl px-5 focus:ring-1 focus:ring-blue-600 transition-all text-white"
                />
                <button 
                  onClick={sendMessage}
                  className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/20 hover:bg-blue-500 transition-colors"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

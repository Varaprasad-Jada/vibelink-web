import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';

export function useWebRTC(socket: Socket | null, onRemoteStream: (stream: MediaStream) => void) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const cleanup = () => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
  };

  const initPC = (targetSocketId: string) => {
    cleanup();
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket?.emit('SIG_ICE', { targetSocketId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      onRemoteStream(event.streams[0]);
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    pcRef.current = pc;
    return pc;
  };

  const startCall = async (targetSocketId: string, stream: MediaStream) => {
    localStreamRef.current = stream;
    const pc = initPC(targetSocketId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket?.emit('SIG_SDP', { targetSocketId, description: offer });
  };

  const handleSdp = async (fromSocketId: string, description: RTCSessionDescriptionInit) => {
    if (!pcRef.current) initPC(fromSocketId);
    const pc = pcRef.current!;

    await pc.setRemoteDescription(new RTCSessionDescription(description));
    if (description.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket?.emit('SIG_SDP', { targetSocketId: fromSocketId, description: answer });
    }
  };

  const handleIce = async (candidate: RTCIceCandidateInit) => {
    try {
      await pcRef.current?.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.error('Error adding ICE candidate', e);
    }
  };

  return { startCall, handleSdp, handleIce, cleanup };
}

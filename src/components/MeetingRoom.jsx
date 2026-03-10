import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video as VideoIcon, VideoOff, Phone, MonitorUp, MoreVertical, MessageSquare, Users, Info, Captions, Hand, GraduationCap } from "lucide-react";
import './MeetingRoom.css';

const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

export default function MeetingRoom({ meetingId, user, onLeave, initialMic, initialVideo }) {
    const wsRef = useRef(null);
    const peersRef = useRef({});
    const candidateQueue = useRef({});
    const localStreamRef = useRef(null);
    const localVideoRef = useRef(null);

    const [participants, setParticipants] = useState([]);
    const [isMicOn, setIsMicOn] = useState(initialMic ?? true);
    const [isVideoOn, setIsVideoOn] = useState(initialVideo ?? true);
    const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

    const userRole = "Student";

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        }, 60000);
        return () => clearInterval(timer);
    }, []);

    const handleEndCall = () => {
        console.log("MeetingRoom.jsx: handleEndCall triggered");
        
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
        }

        if (wsRef.current) {
            wsRef.current.close();
        }

        // Safety check to prevent the "TypeError"
        if (typeof onLeave === 'function') {
            onLeave();
        } else {
            console.error("onLeave prop is missing or not a function!");
            // Fallback to force refresh if navigation fails
            window.location.reload(); 
        }
    };

    const toggleMic = () => {
        if (localStreamRef.current) {
            const enabled = !isMicOn;
            localStreamRef.current.getAudioTracks().forEach(track => track.enabled = enabled);
            setIsMicOn(enabled);
        }
    };

    const toggleVideo = () => {
        if (localStreamRef.current) {
            const enabled = !isVideoOn;
            localStreamRef.current.getVideoTracks().forEach(track => track.enabled = enabled);
            setIsVideoOn(enabled);
        }
    };

    useEffect(() => {
        const start = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                localStreamRef.current = stream;
                if (localVideoRef.current) localVideoRef.current.srcObject = stream;

                const ws = new WebSocket(`wss://snappier-reapply-kieth.ngrok-free.dev/ws/meeting/${meetingId}/`);
                wsRef.current = ws;

                ws.onopen = () => {
                    ws.send(JSON.stringify({ type: "join-room", user_id: user.id, name: user.name, role: "student" }));
                };

                ws.onmessage = async (event) => {
                    const data = JSON.parse(event.data);
                    switch (data.type) {
                        case "existing-users":
                            data.users.forEach(u => { if (u.user_id !== user.id) createPeer(u.user_id, true); });
                            break;
                        case "user-connected":
                            if (data.user_id !== user.id) createPeer(data.user_id, true);
                            break;
                        case "offer":
                            await handleOffer(data.offer, data.caller_id);
                            break;
                        case "answer":
                            const peer = peersRef.current[data.caller_id];
                            if (peer) {
                                await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
                                flushCandidates(data.caller_id);
                            }
                            break;
                        case "ice-candidate":
                            handleCandidate(data);
                            break;
                        case "user-disconnected":
                            removePeer(data.user_id);
                            break;
                        default: break;
                    }
                };
            } catch (err) { console.error(err); }
        };
        start();
        return () => {
            if (wsRef.current) wsRef.current.close();
            if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
        };
    }, [meetingId, user.id, user.name]);

    const createPeer = async (remoteId, initiator = false) => {
        if (peersRef.current[remoteId]) return;
        const peer = new RTCPeerConnection(rtcConfig);
        peersRef.current[remoteId] = peer;
        localStreamRef.current.getTracks().forEach(track => peer.addTrack(track, localStreamRef.current));

        peer.ontrack = (event) => {
            setParticipants(prev => {
                if (prev.find(p => p.id === remoteId)) return prev;
                return [...prev, { id: remoteId, stream: event.streams[0] }];
            });
        };

        peer.onicecandidate = (event) => {
            if (event.candidate) {
                wsRef.current.send(JSON.stringify({ type: "ice-candidate", candidate: event.candidate, caller_id: user.id, target_id: remoteId }));
            }
        };

        if (initiator) {
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            wsRef.current.send(JSON.stringify({ type: "offer", offer, caller_id: user.id, target_id: remoteId }));
        }
    };

    const handleOffer = async (offer, callerId) => {
        const peer = new RTCPeerConnection(rtcConfig);
        peersRef.current[callerId] = peer;
        localStreamRef.current.getTracks().forEach(track => peer.addTrack(track, localStreamRef.current));

        peer.ontrack = (event) => {
            setParticipants(prev => {
                if (prev.find(p => p.id === callerId)) return prev;
                return [...prev, { id: callerId, stream: event.streams[0] }];
            });
        };

        peer.onicecandidate = (event) => {
            if (event.candidate) {
                wsRef.current.send(JSON.stringify({ type: "ice-candidate", candidate: event.candidate, caller_id: user.id, target_id: callerId }));
            }
        };

        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        flushCandidates(callerId);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        wsRef.current.send(JSON.stringify({ type: "answer", answer, caller_id: user.id, target_id: callerId }));
    };

    const handleCandidate = async (data) => {
        const peer = peersRef.current[data.caller_id];
        if (!peer || !peer.remoteDescription) {
            if (!candidateQueue.current[data.caller_id]) candidateQueue.current[data.caller_id] = [];
            candidateQueue.current[data.caller_id].push(data.candidate);
            return;
        }
        await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
    };

    const flushCandidates = async (peerId) => {
        const peer = peersRef.current[peerId];
        const queue = candidateQueue.current[peerId];
        if (!queue || !peer) return;
        for (const candidate of queue) await peer.addIceCandidate(new RTCIceCandidate(candidate));
        delete candidateQueue.current[peerId];
    };

    const removePeer = (id) => {
        if (peersRef.current[id]) { peersRef.current[id].close(); delete peersRef.current[id]; }
        setParticipants(prev => prev.filter(p => p.id !== id));
    };

    return (
        <div className="meet-container">
            <div className="meet-main">
                <div className="meet-grid">
                    <div className="meet-tile">
                        <video ref={localVideoRef} className="meet-video flipped" autoPlay muted playsInline />
                        <div className="meet-label">
                            <span className="role-tag"><GraduationCap size={12}/> {userRole}</span>
                            {!isMicOn && <div className="meet-mic-indicator muted"><MicOff size={14} /></div>}
                            You ({user.name})
                        </div>
                    </div>

                    {participants.map(p => (
                        <div className="meet-tile" key={p.id}>
                            <video className="meet-video" autoPlay playsInline ref={(el) => { if (el && p.stream) el.srcObject = p.stream; }} />
                            <div className="meet-label">Participant {p.id.toString().substring(0, 4)}</div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="meet-bottom-bar">
                <div className="meet-bar-center">
                    <button className={`meet-btn ${!isMicOn ? 'active-red' : ''}`} onClick={toggleMic}>
                        {isMicOn ? <Mic size={20} /> : <MicOff size={20} />}
                    </button>
                    <button className={`meet-btn ${!isVideoOn ? 'active-red' : ''}`} onClick={toggleVideo}>
                        {isVideoOn ? <VideoIcon size={20} /> : <VideoOff size={20} />}
                    </button>
                    <button className="meet-btn-end" onClick={handleEndCall}>
                        <Phone size={24} style={{ transform: 'rotate(135deg)' }} />
                    </button>
                </div>
            </div>
        </div>
    );
}
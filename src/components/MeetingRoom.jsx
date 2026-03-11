import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video as VideoIcon, VideoOff, Phone, MonitorUp, MonitorX, MoreVertical, MessageSquare, Users, Info, Captions, Hand, Send, X, GraduationCap } from "lucide-react";
import './MeetingRoom.css';

// Component for Remote Videos
function RemoteVideo({ stream, participantId, handRaised }) {
    const videoRef = useRef(null);

    const attachStream = (video, s) => {
        if (!video || !s) return;
        if (video.srcObject !== s) {
            video.srcObject = s;
        }
        if (video.paused) video.play().catch(() => { });
    };

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !stream) return;
        attachStream(video, stream);
        const poll = setInterval(() => attachStream(video, stream), 500);
        return () => clearInterval(poll);
    }, [stream]);

    return (
        <div className="meet-tile">
            <video 
                ref={videoRef} 
                className="meet-video" 
                autoPlay 
                playsInline 
            />
            {handRaised && <div className="meet-hand-badge">✋</div>}
            {/* Added toString() and check to prevent substring error */}
            <div className="meet-label">Participant {String(participantId || "").substring(0, 5)}</div>
        </div>
    );
}

const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

export default function MeetingRoom({ meetingId, user, onLeave }) {
    const wsRef = useRef(null);
    const peersRef = useRef({});
    const remoteStreamsRef = useRef({});
    const candidateQueue = useRef({});
    const localStreamRef = useRef(null);
    const localVideoRef = useRef(null);

    const [participants, setParticipants] = useState([]);
    const [isMicOn, setIsMicOn] = useState(true);
    const [isVideoOn, setIsVideoOn] = useState(true);
    const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

    // Feature States
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [isHandRaised, setIsHandRaised] = useState(false);
    const [showChat, setShowChat] = useState(false);
    const [chatMessages, setChatMessages] = useState([]);
    const [chatInput, setChatInput] = useState("");
    const [reactions, setReactions] = useState([]);
    const reactionId = useRef(0);
    const EMOJIS = ["👍", "❤️", "😂", "😮", "👏", "🎉", "🔥", "✋"];

    const safeSend = (data) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(data));
        }
    };

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        }, 60000);
        return () => clearInterval(timer);
    }, []);

    const handleEndCall = () => {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
        }
        if (wsRef.current) wsRef.current.close();
        if (typeof onLeave === 'function') onLeave();
    };

    const toggleHand = () => {
        const newState = !isHandRaised;
        setIsHandRaised(newState);
        safeSend({ type: "activity", activity_type: "hand-raise", value: newState, sender_id: user.id });
    };

    const sendChat = () => {
        const msg = chatInput.trim();
        if (!msg) return;
        setChatMessages(prev => [...prev, { id: Date.now(), sender: user.name || 'You', text: msg, own: true }]);
        safeSend({ type: "activity", activity_type: "chat", text: msg, sender_name: user.name });
        setChatInput("");
    };

    const sendReaction = (emoji) => {
        const id = ++reactionId.current;
        setReactions(prev => [...prev, { id, emoji, x: 20 + Math.random() * 60 }]);
        setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 3000);
        safeSend({ type: "activity", activity_type: "reaction", emoji: emoji });
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
                    safeSend({ type: "join-room", user_id: user.id, name: user.name, role: "student" });
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
                            if (peersRef.current[data.caller_id]) {
                                await peersRef.current[data.caller_id].setRemoteDescription(new RTCSessionDescription(data.answer));
                                flushCandidates(data.caller_id);
                            }
                            break;
                        case "ice-candidate":
                            handleCandidate(data);
                            break;
                        case "activity":
                            if (data.activity_type === "hand-raise") {
                                setParticipants(prev => prev.map(p => p.id === data.sender_id ? { ...p, handRaised: data.value } : p));
                            } else if (data.activity_type === "chat") {
                                setChatMessages(prev => [...prev, { id: Date.now(), sender: data.sender_name, text: data.text, own: false }]);
                            } else if (data.activity_type === "reaction") {
                                const id = ++reactionId.current;
                                setReactions(prev => [...prev, { id, emoji: data.emoji, x: 20 + Math.random() * 60 }]);
                                setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 3000);
                            }
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
        return () => { if (wsRef.current) wsRef.current.close(); };
    }, [meetingId]);

    const createPeer = async (remoteId, initiator = false) => {
        if (peersRef.current[remoteId]) return;
        const peer = new RTCPeerConnection(rtcConfig);
        peersRef.current[remoteId] = peer;
        const remoteStream = new MediaStream();
        remoteStreamsRef.current[remoteId] = remoteStream;

        setParticipants(prev => [...prev, { id: remoteId, stream: remoteStream, handRaised: false }]);
        localStreamRef.current.getTracks().forEach(track => peer.addTrack(track, localStreamRef.current));

        peer.ontrack = (event) => {
            if (!remoteStream.getTracks().find(t => t.id === event.track.id)) {
                remoteStream.addTrack(event.track);
            }
            setParticipants(prev => [...prev]);
        };

        peer.onicecandidate = (event) => {
            if (event.candidate) safeSend({ type: "ice-candidate", candidate: event.candidate, caller_id: user.id, target_id: remoteId });
        };

        if (initiator) {
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            safeSend({ type: "offer", offer, caller_id: user.id, target_id: remoteId });
        }
    };

    const handleOffer = async (offer, callerId) => {
        await createPeer(callerId, false);
        const peer = peersRef.current[callerId];
        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        flushCandidates(callerId);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        safeSend({ type: "answer", answer, caller_id: user.id, target_id: callerId });
    };

    const handleCandidate = async (data) => {
        const peer = peersRef.current[data.caller_id];
        if (peer && peer.remoteDescription) {
            await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
        } else {
            if (!candidateQueue.current[data.caller_id]) candidateQueue.current[data.caller_id] = [];
            candidateQueue.current[data.caller_id].push(data.candidate);
        }
    };

    const flushCandidates = async (peerId) => {
        const queue = candidateQueue.current[peerId];
        if (queue) {
            for (const cand of queue) await peersRef.current[peerId].addIceCandidate(new RTCIceCandidate(cand));
            delete candidateQueue.current[peerId];
        }
    };

    const removePeer = (id) => {
        if (peersRef.current[id]) peersRef.current[id].close();
        delete peersRef.current[id];
        setParticipants(prev => prev.filter(p => p.id !== id));
    };

    return (
        <div className="meet-container">
            <div className="meet-reactions-stage">
                {reactions.map(r => <span key={r.id} className="meet-reaction-bubble" style={{ left: `${r.x}%` }}>{r.emoji}</span>)}
            </div>

            <div className="meet-main">
                <div className="meet-grid">
                    <div className="meet-tile">
                        <video ref={localVideoRef} className="meet-video flipped" autoPlay muted playsInline />
                        {isHandRaised && <div className="meet-hand-badge">✋</div>}
                        <div className="meet-label">
                            <span className="role-tag"><GraduationCap size={12}/> Student</span>
                            You ({user.name})
                        </div>
                    </div>
                    {participants.map(p => <RemoteVideo key={p.id} stream={p.stream} participantId={p.id} handRaised={p.handRaised} />)}
                </div>

                {showChat && (
                    <div className="meet-side-panel">
                        <div className="meet-panel-header"><span>Chat</span><button onClick={() => setShowChat(false)}><X size={18} /></button></div>
                        <div className="meet-chat-messages">
                            {chatMessages.map(m => (
                                <div key={m.id} className={`meet-chat-msg ${m.own ? 'own' : ''}`}>
                                    <span className="meet-chat-sender">{m.sender}</span>
                                    <span className="meet-chat-text">{m.text}</span>
                                </div>
                            ))}
                        </div>
                        <div className="meet-chat-input-row">
                            <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()} placeholder="Message..." />
                            <button onClick={sendChat}><Send size={16} /></button>
                        </div>
                    </div>
                )}
            </div>

            <div className="meet-bottom-bar">
                {/* Fixed substring error here by converting to String */}
                <div className="meet-bar-left">{currentTime} | {String(meetingId || "").substring(0, 11)}...</div>
                <div className="meet-bar-center">
                    <button className={`meet-btn ${!isMicOn ? 'active-red' : ''}`} onClick={() => { 
                        localStreamRef.current.getAudioTracks()[0].enabled = !isMicOn; 
                        setIsMicOn(!isMicOn); 
                    }}><Mic size={20} /></button>
                    <button className={`meet-btn ${!isVideoOn ? 'active-red' : ''}`} onClick={() => { 
                        localStreamRef.current.getVideoTracks()[0].enabled = !isVideoOn; 
                        setIsVideoOn(!isVideoOn); 
                    }}><VideoIcon size={20} /></button>
                    <button className={`meet-btn ${isHandRaised ? 'active-yellow' : ''}`} onClick={toggleHand}><Hand size={20} /></button>
                    <button className="meet-btn" onClick={() => sendReaction("😂")}>😂</button>
                    <button className="meet-btn-end" onClick={handleEndCall}><Phone size={24} style={{ transform: 'rotate(135deg)' }} /></button>
                </div>
                <div className="meet-bar-right">
                    <button onClick={() => setShowChat(!showChat)}><MessageSquare size={20} /></button>
                </div>
            </div>
        </div>
    );
}
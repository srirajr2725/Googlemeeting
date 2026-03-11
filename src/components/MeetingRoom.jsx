import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video as VideoIcon, VideoOff, Phone, MessageSquare, Hand, GraduationCap, X, Send } from "lucide-react";
import './MeetingRoom.css';

// Component for Remote Videos
function RemoteVideo({ stream, participantId, handRaised }) {
    const videoRef = useRef(null);
    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    return (
        <div className="meet-tile">
            <video ref={videoRef} className="meet-video" autoPlay playsInline />
            {handRaised && <div className="meet-hand-badge">✋</div>}
            <div className="meet-label">Participant {String(participantId || "").substring(0, 5)}</div>
        </div>
    );
}

const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

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
    const [isHandRaised, setIsHandRaised] = useState(false);
    const [showChat, setShowChat] = useState(false);
    const [chatMessages, setChatMessages] = useState([]);
    const [chatInput, setChatInput] = useState("");
    const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

    const safeSend = (data) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(data));
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
                            await handleAnswer(data.answer, data.caller_id); // Fixed function
                            break;
                        case "ice-candidate":
                            handleCandidate(data);
                            break;
                        case "activity":
                            handleActivity(data);
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

    const handleAnswer = async (answer, callerId) => {
        const peer = peersRef.current[callerId];
        // FIX: Check for peer existence AND signaling state
        if (peer && peer.signalingState === "have-local-offer") {
            await peer.setRemoteDescription(new RTCSessionDescription(answer));
            flushCandidates(callerId);
        }
    };

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
        } else if (peer) {
            if (!candidateQueue.current[data.caller_id]) candidateQueue.current[data.caller_id] = [];
            candidateQueue.current[data.caller_id].push(data.candidate);
        }
    };

    const flushCandidates = async (peerId) => {
        const queue = candidateQueue.current[peerId];
        if (queue && peersRef.current[peerId]) {
            for (const cand of queue) await peersRef.current[peerId].addIceCandidate(new RTCIceCandidate(cand));
            delete candidateQueue.current[peerId];
        }
    };

    const removePeer = (id) => {
        if (peersRef.current[id]) peersRef.current[id].close();
        delete peersRef.current[id];
        setParticipants(prev => prev.filter(p => p.id !== id));
    };

    const handleActivity = (data) => {
        if (data.activity_type === "hand-raise") {
            setParticipants(prev => prev.map(p => p.id === data.sender_id ? { ...p, handRaised: data.value } : p));
        } else if (data.activity_type === "chat") {
            setChatMessages(prev => [...prev, { id: Date.now(), sender: data.sender_name, text: data.text, own: false }]);
        }
    };

    const toggleHand = () => {
        const newState = !isHandRaised;
        setIsHandRaised(newState);
        safeSend({ type: "activity", activity_type: "hand-raise", value: newState, sender_id: user.id });
    };

    return (
        <div className="meet-container">
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
            </div>

            <div className="meet-bottom-bar">
                <div className="meet-bar-left">{currentTime} | {String(meetingId || "").substring(0, 11)}...</div>
                <div className="meet-bar-center">
                    <button className="meet-btn" onClick={() => setIsMicOn(!isMicOn)}>{isMicOn ? <Mic /> : <MicOff />}</button>
                    <button className="meet-btn" onClick={() => setIsVideoOn(!isVideoOn)}>{isVideoOn ? <VideoIcon /> : <VideoOff />}</button>
                    <button className={`meet-btn ${isHandRaised ? 'active-yellow' : ''}`} onClick={toggleHand}><Hand /></button>
                    <button className="meet-btn-end" onClick={onLeave}><Phone style={{ transform: 'rotate(135deg)' }} /></button>
                </div>
                <div className="meet-bar-right">
                    <button onClick={() => setShowChat(!showChat)}><MessageSquare /></button>
                </div>
            </div>
        </div>
    );
}
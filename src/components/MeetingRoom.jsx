import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video as VideoIcon, VideoOff, Phone, MonitorUp, MonitorX, MoreVertical, MessageSquare, Users, Info, Captions, Hand, Send, X } from "lucide-react";
import './MeetingRoom.css';

// Dedicated component — attaches srcObject on mount and whenever
// new tracks are added, with a polling fallback for edge cases.
function RemoteVideo({ stream, participantId }) {
    const videoRef = useRef(null);

    // Always (re-)attach as soon as both stream and DOM node exist
    const attachStream = (video, s) => {
        if (!video || !s) return;
        if (video.srcObject !== s) {
            video.srcObject = s;
        }
        // If paused or not playing, try to play
        if (video.paused) {
            video.play().catch(e => console.warn("play() failed:", e));
        }
    };

    // Ref callback: fires whenever the DOM node mounts/changes
    const setVideoRef = (video) => {
        videoRef.current = video;
        attachStream(video, stream);
    };

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !stream) return;

        attachStream(video, stream);

        // Listen for future tracks added to the same stream object
        const onAddTrack = () => attachStream(video, stream);
        stream.addEventListener('addtrack', onAddTrack);

        return () => {
            stream.removeEventListener('addtrack', onAddTrack);
        };
    }, [stream]);

    return (
        <div className="meet-tile">
            <video
                ref={setVideoRef}
                className="meet-video"
                autoPlay
                playsInline
            />
            <div className="meet-label">Participant {participantId}</div>
        </div>
    );
}

const rtcConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ]
};

export default function MeetingRoom({ meetingId, user, onLeave }) {

    const wsRef = useRef(null);
    const peersRef = useRef({});
    const remoteStreamsRef = useRef({}); // Stores all remote MediaStreams directly
    const candidateQueue = useRef({});
    const localStreamRef = useRef(null);
    const localVideoRef = useRef(null);

    const [participants, setParticipants] = useState([]);

    const [isMicOn, setIsMicOn] = useState(true);
    const [isVideoOn, setIsVideoOn] = useState(true);
    const [currentTime, setCurrentTime] = useState(
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );

    // ── NEW FEATURE STATE ──────────────────────────────────────────
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const screenStreamRef = useRef(null);

    const [isHandRaised, setIsHandRaised] = useState(false);

    const [showParticipants, setShowParticipants] = useState(false);

    const [showChat, setShowChat] = useState(false);
    const [chatMessages, setChatMessages] = useState([]);
    const [chatInput, setChatInput] = useState("");
    const chatEndRef = useRef(null);

    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [reactions, setReactions] = useState([]);
    const reactionId = useRef(0);
    const EMOJIS = ["👍", "❤️", "😂", "😮", "👏", "🎉", "🔥", "😢"];

    const safeSend = (data) => {

        if (!wsRef.current) return;

        if (wsRef.current.readyState === WebSocket.OPEN) {

            wsRef.current.send(JSON.stringify(data));

        } else {

            const interval = setInterval(() => {

                if (wsRef.current.readyState === WebSocket.OPEN) {

                    wsRef.current.send(JSON.stringify(data));
                    clearInterval(interval);

                }

            }, 50);

        }

    };

    useEffect(() => {

        const timer = setInterval(() => {

            setCurrentTime(
                new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            );

        }, 60000);

        return () => clearInterval(timer);

    }, []);

    const toggleMic = () => {

        if (localStreamRef.current) {

            localStreamRef.current.getAudioTracks().forEach(track => track.enabled = !isMicOn);
            setIsMicOn(!isMicOn);

        }

    };

    const toggleVideo = () => {

        if (localStreamRef.current) {

            localStreamRef.current.getVideoTracks().forEach(track => track.enabled = !isVideoOn);
            setIsVideoOn(!isVideoOn);

        }

    };

    // ── SCREEN SHARE ──────────────────────────────────────────────
    const toggleScreenShare = async () => {
        if (isScreenSharing) {
            // Stop screen share – restore camera
            if (screenStreamRef.current) {
                screenStreamRef.current.getTracks().forEach(t => t.stop());
                screenStreamRef.current = null;
            }
            if (localStreamRef.current && localVideoRef.current) {
                localVideoRef.current.srcObject = localStreamRef.current;
            }
            setIsScreenSharing(false);
        } else {
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
                screenStreamRef.current = screenStream;
                if (localVideoRef.current) localVideoRef.current.srcObject = screenStream;
                // Replace video track in all peers
                const screenTrack = screenStream.getVideoTracks()[0];
                Object.values(peersRef.current).forEach(peer => {
                    const sender = peer.getSenders().find(s => s.track && s.track.kind === 'video');
                    if (sender) sender.replaceTrack(screenTrack);
                });
                screenTrack.onended = () => toggleScreenShare();
                setIsScreenSharing(true);
            } catch (e) {
                console.warn('Screen share cancelled or failed', e);
            }
        }
    };

    // ── HAND RAISE ────────────────────────────────────────────────
    const toggleHand = () => setIsHandRaised(prev => !prev);

    // ── CHAT ──────────────────────────────────────────────────────
    const sendChat = () => {
        const msg = chatInput.trim();
        if (!msg) return;
        setChatMessages(prev => [...prev, { id: Date.now(), sender: user.name || 'You', text: msg, own: true }]);
        setChatInput("");
    };

    useEffect(() => {
        if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages]);

    // ── EMOJI REACTION ────────────────────────────────────────────
    const sendReaction = (emoji) => {
        const id = ++reactionId.current;
        setReactions(prev => [...prev, { id, emoji, x: 20 + Math.random() * 60 }]);
        setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 3000);
        setShowEmojiPicker(false);
    };

    useEffect(() => {
        let mounted = true;
        let ws = null;

        const start = async () => {
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true
                });
            } catch (err) {
                console.warn("Camera failed, trying audio only", err);
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: false,
                        audio: true
                    });
                    setIsVideoOn(false);
                } catch (audioErr) {
                    console.error("Audio also failed", audioErr);
                    stream = new MediaStream(); // empty stream
                    setIsVideoOn(false);
                    setIsMicOn(false);
                }
            }

            if (!mounted) {
                // strict mode double-invoke cleanup
                stream.getTracks().forEach(t => t.stop());
                return;
            }

            localStreamRef.current = stream;

            if (localVideoRef.current)
                localVideoRef.current.srcObject = stream;

            ws = new WebSocket(
                `wss://snappier-reapply-kieth.ngrok-free.dev/ws/meeting/${meetingId}/`
            );

            wsRef.current = ws;

            ws.onopen = () => {
                safeSend({
                    type: "join-room",
                    user_id: user.id,
                    name: user.name
                });
            };

            ws.onmessage = async (event) => {
                const data = JSON.parse(event.data);
                console.log("WS EVENT:", data);
                switch (data.type) {
                    case "existing-users":
                        data.users.forEach(u => {
                            if (u.user_id !== user.id)
                                createPeer(u.user_id, true);
                        });
                        break;
                    case "user-connected":
                        if (data.user_id !== user.id)
                            createPeer(data.user_id, true);
                        break;
                    case "offer":
                        await handleOffer(data.offer, data.caller_id);
                        break;
                    case "answer":
                        await handleAnswer(data.answer, data.caller_id);
                        break;
                    case "ice-candidate":
                        handleCandidate(data);
                        break;
                    case "user-disconnected":
                        removePeer(data.user_id);
                        break;
                }
            };
        };

        start();

        return () => {
            mounted = false;
            // Clean up to prevent duplicate ghost connections in Strict Mode
            if (ws) ws.close();
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(t => t.stop());
            }
            if (peersRef.current) {
                Object.values(peersRef.current).forEach(p => p.close());
            }
            peersRef.current = {};
            remoteStreamsRef.current = {};
        };
    }, []);

    const createPeer = async (remoteId, initiator = false) => {

        if (peersRef.current[remoteId]) return;

        const peer = new RTCPeerConnection(rtcConfig);
        peersRef.current[remoteId] = peer;

        // Create the MediaStream for this remote peer upfront
        const remoteStream = new MediaStream();
        remoteStreamsRef.current[remoteId] = remoteStream;

        // Immediately add the empty stream to UI so tile appears
        setParticipants(prev => [
            ...prev.filter(p => p.id !== remoteId),
            { id: remoteId, stream: remoteStream }
        ]);

        localStreamRef.current.getTracks().forEach(track => {
            peer.addTrack(track, localStreamRef.current);
        });

        peer.ontrack = (event) => {
            console.log(`[ontrack] Track received from ${remoteId}:`, event.track.kind);

            // Add track to MediaStream 
            if (!remoteStream.getTracks().find(t => t.id === event.track.id)) {
                remoteStream.addTrack(event.track);
                console.log(`[ontrack] Track added to stream for ${remoteId}. Total tracks:`, remoteStream.getTracks().length);
            }

            // Force a hard update of the stream reference so React notices it
            const newStream = new MediaStream(remoteStream.getTracks());
            remoteStreamsRef.current[remoteId] = newStream;

            setParticipants(prev => prev.map(p =>
                p.id === remoteId ? { ...p, stream: newStream } : p
            ));
        };

        peer.onicecandidate = (event) => {

            if (!event.candidate) return;

            safeSend({
                type: "ice-candidate",
                candidate: event.candidate,
                caller_id: user.id,
                target_id: remoteId
            });

        };

        peer.onconnectionstatechange = () => {

            console.log("Connection state:", peer.connectionState);

        };

        if (initiator) {

            const offer = await peer.createOffer();

            await peer.setLocalDescription(offer);

            safeSend({
                type: "offer",
                offer,
                caller_id: user.id,
                target_id: remoteId
            });

        }

    };

    const handleOffer = async (offer, callerId) => {

        let peer = peersRef.current[callerId];

        if (!peer) {

            peer = new RTCPeerConnection(rtcConfig);
            peersRef.current[callerId] = peer;

            // Create the MediaStream upfront
            const remoteStream = new MediaStream();
            remoteStreamsRef.current[callerId] = remoteStream;

            // Immediately add the empty stream to UI
            setParticipants(prev => [
                ...prev.filter(p => p.id !== callerId),
                { id: callerId, stream: remoteStream }
            ]);

            localStreamRef.current.getTracks().forEach(track => {
                peer.addTrack(track, localStreamRef.current);
            });

            peer.ontrack = (event) => {
                console.log(`[ontrack] Track received from ${callerId}:`, event.track.kind);

                if (!remoteStream.getTracks().find(t => t.id === event.track.id)) {
                    remoteStream.addTrack(event.track);
                    console.log(`[ontrack] Track added to stream for ${callerId}. Total tracks:`, remoteStream.getTracks().length);
                }

                const newStream = new MediaStream(remoteStream.getTracks());
                remoteStreamsRef.current[callerId] = newStream;

                setParticipants(prev => prev.map(p =>
                    p.id === callerId ? { ...p, stream: newStream } : p
                ));
            };

            peer.onicecandidate = (event) => {

                if (!event.candidate) return;

                safeSend({
                    type: "ice-candidate",
                    candidate: event.candidate,
                    caller_id: user.id,
                    target_id: callerId
                });

            };

        }

        await peer.setRemoteDescription(
            new RTCSessionDescription(offer)
        );

        flushCandidates(callerId);

        const answer = await peer.createAnswer();

        await peer.setLocalDescription(answer);

        safeSend({
            type: "answer",
            answer,
            caller_id: user.id,
            target_id: callerId
        });

    };

    const handleAnswer = async (answer, callerId) => {

        const peer = peersRef.current[callerId];

        if (!peer) return;

        if (peer.signalingState !== "have-local-offer") return;

        await peer.setRemoteDescription(
            new RTCSessionDescription(answer)
        );

        flushCandidates(callerId);

    };

    const handleCandidate = async (data) => {

        const peer = peersRef.current[data.caller_id];

        if (!peer || !peer.remoteDescription) {

            if (!candidateQueue.current[data.caller_id])
                candidateQueue.current[data.caller_id] = [];

            candidateQueue.current[data.caller_id].push(data.candidate);

            return;

        }

        await peer.addIceCandidate(
            new RTCIceCandidate(data.candidate)
        );

    };

    const flushCandidates = async (peerId) => {

        const peer = peersRef.current[peerId];
        const queue = candidateQueue.current[peerId];

        if (!queue || !peer) return;

        for (const candidate of queue) {

            await peer.addIceCandidate(
                new RTCIceCandidate(candidate)
            );

        }

        delete candidateQueue.current[peerId];

    };

    const removePeer = (id) => {

        if (!peersRef.current[id]) return;

        peersRef.current[id].close();
        delete peersRef.current[id];

        setParticipants(prev => prev.filter(p => p.id !== id));

    };

    return (
        <div className="meet-container">

            {/* ── FLOATING EMOJI REACTIONS ───────────────────────────── */}
            <div className="meet-reactions-stage">
                {reactions.map(r => (
                    <span
                        key={r.id}
                        className="meet-reaction-bubble"
                        style={{ left: `${r.x}%` }}
                    >
                        {r.emoji}
                    </span>
                ))}
            </div>

            <div className="meet-main" style={{ position: 'relative' }}>
                <div className="meet-grid">

                    {/* Local tile */}
                    <div className="meet-tile">
                        <video
                            ref={localVideoRef}
                            className={`meet-video${isScreenSharing ? '' : ' flipped'}`}
                            autoPlay
                            muted
                            playsInline
                        />
                        {isHandRaised && (
                            <div className="meet-hand-badge">✋</div>
                        )}
                        <div className="meet-label">
                            {!isMicOn && (
                                <div className="meet-mic-indicator muted">
                                    <MicOff size={14} color="white" />
                                </div>
                            )}
                            You {isScreenSharing && <span className="meet-screen-badge">● Presenting</span>}
                        </div>
                    </div>

                    {participants.map(p => (
                        <RemoteVideo key={p.id} participantId={p.id} stream={p.stream} />
                    ))}

                </div>

                {/* ── PARTICIPANTS PANEL ─────────────────────────────────── */}
                {showParticipants && (
                    <div className="meet-side-panel">
                        <div className="meet-panel-header">
                            <span>People ({participants.length + 1})</span>
                            <button className="meet-panel-close" onClick={() => setShowParticipants(false)}><X size={18} /></button>
                        </div>
                        <ul className="meet-panel-list">
                            <li className="meet-panel-item">
                                <div className="meet-avatar" style={{ background: '#1a73e8' }}>
                                    {(user.name || 'Y')[0].toUpperCase()}
                                </div>
                                <span>{user.name || 'You'} <em>(You)</em></span>
                                {isHandRaised && <span className="meet-hand-icon">✋</span>}
                            </li>
                            {participants.map(p => (
                                <li className="meet-panel-item" key={p.id}>
                                    <div className="meet-avatar" style={{ background: '#34a853' }}>
                                        P
                                    </div>
                                    <span>Participant {String(p.id).substring(0, 6)}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* ── CHAT PANEL ─────────────────────────────────────────── */}
                {showChat && (
                    <div className="meet-side-panel">
                        <div className="meet-panel-header">
                            <span>In-call messages</span>
                            <button className="meet-panel-close" onClick={() => setShowChat(false)}><X size={18} /></button>
                        </div>
                        <div className="meet-chat-messages">
                            {chatMessages.length === 0 && (
                                <p className="meet-chat-empty">No messages yet. Say hello! 👋</p>
                            )}
                            {chatMessages.map(m => (
                                <div key={m.id} className={`meet-chat-msg ${m.own ? 'own' : ''}`}>
                                    <span className="meet-chat-sender">{m.sender}</span>
                                    <span className="meet-chat-text">{m.text}</span>
                                </div>
                            ))}
                            <div ref={chatEndRef} />
                        </div>
                        <div className="meet-chat-input-row">
                            <input
                                className="meet-chat-input"
                                placeholder="Send a message..."
                                value={chatInput}
                                onChange={e => setChatInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && sendChat()}
                            />
                            <button className="meet-chat-send" onClick={sendChat}><Send size={16} /></button>
                        </div>
                    </div>
                )}
            </div>

            {/* ── BOTTOM BAR ─────────────────────────────────────────── */}
            <div className="meet-bottom-bar">

                <div className="meet-bar-left">
                    {currentTime} | {String(meetingId).substring(0, 11)}...
                </div>

                <div className="meet-bar-center">

                    <button className={`meet-btn ${!isMicOn ? 'active-red' : ''}`} onClick={toggleMic} title="Microphone">
                        {isMicOn ? <Mic size={20} /> : <MicOff size={20} />}
                    </button>

                    <button className={`meet-btn ${!isVideoOn ? 'active-red' : ''}`} onClick={toggleVideo} title="Camera">
                        {isVideoOn ? <VideoIcon size={20} /> : <VideoOff size={20} />}
                    </button>

                    {/* Screen Share */}
                    <button
                        className={`meet-btn ${isScreenSharing ? 'active-blue' : ''}`}
                        onClick={toggleScreenShare}
                        title={isScreenSharing ? 'Stop presenting' : 'Present now'}
                    >
                        {isScreenSharing ? <MonitorX size={20} /> : <MonitorUp size={20} />}
                    </button>

                    {/* Hand raise */}
                    <button
                        className={`meet-btn ${isHandRaised ? 'active-yellow' : ''}`}
                        onClick={toggleHand}
                        title={isHandRaised ? 'Lower hand' : 'Raise hand'}
                    >
                        <Hand size={20} />
                    </button>

                    {/* Emoji reactions */}
                    <div style={{ position: 'relative' }}>
                        <button
                            className="meet-btn"
                            onClick={() => setShowEmojiPicker(prev => !prev)}
                            title="Send a reaction"
                        >
                            <span style={{ fontSize: 18 }}>😊</span>
                        </button>
                        {showEmojiPicker && (
                            <div className="meet-emoji-picker">
                                {EMOJIS.map(e => (
                                    <button key={e} className="meet-emoji-btn" onClick={() => sendReaction(e)}>
                                        {e}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <button className="meet-btn" title="Captions">
                        <Captions size={20} />
                    </button>

                    <button className="meet-btn" title="More options">
                        <MoreVertical size={20} />
                    </button>

                    <button className="meet-btn-end" onClick={() => {
                        if (onLeave) onLeave();
                        else window.location.reload();
                    }}>
                        <Phone size={24} style={{ transform: 'rotate(135deg)' }} />
                    </button>

                </div>

                <div className="meet-bar-right">
                    <button className="meet-small-btn" title="Meeting info">
                        <Info size={20} />
                    </button>
                    <button
                        className={`meet-small-btn ${showParticipants ? 'active-panel' : ''}`}
                        title="People"
                        onClick={() => { setShowParticipants(p => !p); setShowChat(false); }}
                    >
                        <Users size={20} />
                    </button>
                    <button
                        className={`meet-small-btn ${showChat ? 'active-panel' : ''}`}
                        title="Chat"
                        onClick={() => { setShowChat(p => !p); setShowParticipants(false); }}
                    >
                        <MessageSquare size={20} />
                    </button>
                </div>

            </div>
        </div>
    );
}
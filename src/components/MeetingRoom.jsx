import React, { useEffect, useRef, useState, useCallback } from "react";
import {
    Mic, MicOff, Video as VideoIcon, VideoOff, Phone,
    MonitorUp, MonitorX, MoreVertical, MessageSquare,
    Users, Info, Captions, Hand, Send, X
} from "lucide-react";

// ─── RemoteVideo ─────────────────────────────────────────────────────────────
// Uses a callback ref so srcObject is (re-)set whenever the DOM node OR the
// stream prop changes, eliminating the "black tile" race condition.
function RemoteVideo({ stream, participantId }) {
    const videoRef = useRef(null);

    // Attach stream to video element
    const attach = useCallback((video, s) => {
        if (!video) return;
        if (video.srcObject === s) return;
        video.srcObject = s ?? null;
        if (s) {
            video.play().catch(() => {/* autoplay policy – user gesture needed */});
        }
    }, []);

    // Callback ref: fires on mount AND unmount of the DOM node
    const refCallback = useCallback((video) => {
        videoRef.current = video;
        attach(video, stream);
    }, [stream, attach]);

    // Also re-attach whenever the `stream` prop changes
    useEffect(() => {
        attach(videoRef.current, stream);
    }, [stream, attach]);

    return (
        <div className="meet-tile">
            <video
                ref={refCallback}
                className="meet-video"
                autoPlay
                playsInline
            />
            <div className="meet-label">Participant {String(participantId).substring(0, 6)}</div>
        </div>
    );
}

// ─── RTC config ──────────────────────────────────────────────────────────────
const rtcConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
    ],
};

// ─── MeetingRoom ─────────────────────────────────────────────────────────────
export default function MeetingRoom({ meetingId, user, onLeave }) {
    const wsRef             = useRef(null);
    const peersRef          = useRef({});           // peerId → RTCPeerConnection
    const remoteStreamsRef  = useRef({});            // peerId → MediaStream (stable ref)
    const candidateQueue    = useRef({});            // peerId → RTCIceCandidateInit[]
    const localStreamRef    = useRef(null);
    const localVideoRef     = useRef(null);

    const [participants, setParticipants] = useState([]);   // [{id, stream}]

    const [isMicOn,   setIsMicOn]   = useState(true);
    const [isVideoOn, setIsVideoOn] = useState(true);
    const [currentTime, setCurrentTime] = useState(
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );

    // New-feature state
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const screenStreamRef = useRef(null);

    const [isHandRaised, setIsHandRaised] = useState(false);

    const [showParticipants, setShowParticipants] = useState(false);
    const [showChat,         setShowChat]         = useState(false);
    const [chatMessages,     setChatMessages]     = useState([]);
    const [chatInput,        setChatInput]        = useState("");
    const chatEndRef = useRef(null);

    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [reactions,       setReactions]       = useState([]);
    const reactionIdRef = useRef(0);
    const EMOJIS = ["👍", "❤️", "😂", "😮", "👏", "🎉", "🔥", "😢"];

    // ── Helpers ───────────────────────────────────────────────────────────────
    const safeSend = useCallback((data) => {
        const ws = wsRef.current;
        if (!ws) return;
        const send = () => ws.send(JSON.stringify(data));
        if (ws.readyState === WebSocket.OPEN) {
            send();
        } else {
            const iv = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) { send(); clearInterval(iv); }
            }, 50);
        }
    }, []);

    // ── Clock ────────────────────────────────────────────────────────────────
    useEffect(() => {
        const t = setInterval(() =>
            setCurrentTime(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })),
        60000);
        return () => clearInterval(t);
    }, []);

    // ── Mic / Video toggles ───────────────────────────────────────────────────
    const toggleMic = () => {
        localStreamRef.current?.getAudioTracks().forEach(t => (t.enabled = !isMicOn));
        setIsMicOn(v => !v);
    };
    const toggleVideo = () => {
        localStreamRef.current?.getVideoTracks().forEach(t => (t.enabled = !isVideoOn));
        setIsVideoOn(v => !v);
    };

    // ── Screen share ──────────────────────────────────────────────────────────
    const toggleScreenShare = useCallback(async () => {
        if (isScreenSharing) {
            screenStreamRef.current?.getTracks().forEach(t => t.stop());
            screenStreamRef.current = null;
            if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
            // Restore camera track in all peers
            const camTrack = localStreamRef.current?.getVideoTracks()[0];
            if (camTrack) {
                Object.values(peersRef.current).forEach(peer => {
                    const sender = peer.getSenders().find(s => s.track?.kind === "video");
                    sender?.replaceTrack(camTrack);
                });
            }
            setIsScreenSharing(false);
        } else {
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
                screenStreamRef.current = screenStream;
                if (localVideoRef.current) localVideoRef.current.srcObject = screenStream;
                const screenTrack = screenStream.getVideoTracks()[0];
                Object.values(peersRef.current).forEach(peer => {
                    const sender = peer.getSenders().find(s => s.track?.kind === "video");
                    sender?.replaceTrack(screenTrack);
                });
                screenTrack.onended = () => toggleScreenShare();
                setIsScreenSharing(true);
            } catch (e) {
                console.warn("Screen share cancelled", e);
            }
        }
    }, [isScreenSharing]);

    // ── Hand raise ────────────────────────────────────────────────────────────
    const toggleHand = () => setIsHandRaised(v => !v);

    // ── Chat ──────────────────────────────────────────────────────────────────
    const sendChat = () => {
        const msg = chatInput.trim();
        if (!msg) return;
        setChatMessages(prev => [...prev, { id: Date.now(), sender: user.name || "You", text: msg, own: true }]);
        setChatInput("");
    };
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [chatMessages]);

    // ── Emoji reactions ───────────────────────────────────────────────────────
    const sendReaction = (emoji) => {
        const id = ++reactionIdRef.current;
        setReactions(prev => [...prev, { id, emoji, x: 20 + Math.random() * 60 }]);
        setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 3000);
        setShowEmojiPicker(false);
    };

    // ── WebRTC peer helpers ───────────────────────────────────────────────────

    /**
     * KEY FIX: We keep ONE stable MediaStream per peer (remoteStreamsRef).
     * When tracks arrive via ontrack, we addTrack to that same stream object
     * instead of creating a new MediaStream each time.
     * React state only needs the stable stream ref; because the MediaStream
     * object itself mutates we force a re-render by toggling a counter.
     */
    const [, forceUpdate] = useState(0);
    const bump = () => setParticipants(prev => [...prev]); // shallow clone → re-render

    const buildPeer = useCallback((remoteId) => {
        const peer = new RTCPeerConnection(rtcConfig);
        peersRef.current[remoteId] = peer;

        // Create a STABLE MediaStream – never replaced, only mutated
        const remoteStream = new MediaStream();
        remoteStreamsRef.current[remoteId] = remoteStream;

        // Add to participants list immediately (shows black tile while waiting)
        setParticipants(prev => [
            ...prev.filter(p => p.id !== remoteId),
            { id: remoteId, stream: remoteStream },
        ]);

        // Add local tracks
        localStreamRef.current?.getTracks().forEach(track =>
            peer.addTrack(track, localStreamRef.current)
        );

        // ── KEY FIX: add track to the stable stream; don't create new stream ──
        peer.ontrack = ({ track, streams }) => {
            console.log(`[ontrack] ${track.kind} from ${remoteId}`);

            // Prefer the first streams[] entry when available (standard path)
            const src = streams?.[0];
            if (src) {
                // Attach the browser-provided stream directly
                remoteStreamsRef.current[remoteId] = src;
                setParticipants(prev =>
                    prev.map(p => p.id === remoteId ? { ...p, stream: src } : p)
                );
            } else {
                // Fallback: manually assemble
                if (!remoteStream.getTracks().find(t => t.id === track.id)) {
                    remoteStream.addTrack(track);
                }
                // Force re-render so RemoteVideo re-attaches
                setParticipants(prev =>
                    prev.map(p => p.id === remoteId ? { ...p, stream: remoteStream } : p)
                );
            }

            // Ensure video plays (some browsers need this after track add)
            track.onunmute = () => bump();
        };

        peer.onicecandidate = ({ candidate }) => {
            if (!candidate) return;
            safeSend({ type: "ice-candidate", candidate, caller_id: user.id, target_id: remoteId });
        };

        peer.onconnectionstatechange = () =>
            console.log(`[peer ${remoteId}] state:`, peer.connectionState);

        return peer;
    }, [safeSend, user.id]);

    const flushCandidates = useCallback(async (peerId) => {
        const peer  = peersRef.current[peerId];
        const queue = candidateQueue.current[peerId];
        if (!queue?.length || !peer) return;
        for (const c of queue) {
            try { await peer.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn(e); }
        }
        delete candidateQueue.current[peerId];
    }, []);

    const createPeer = useCallback(async (remoteId, initiator = false) => {
        if (peersRef.current[remoteId]) return;
        const peer = buildPeer(remoteId);
        if (initiator) {
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            safeSend({ type: "offer", offer, caller_id: user.id, target_id: remoteId });
        }
    }, [buildPeer, safeSend, user.id]);

    const handleOffer = useCallback(async (offer, callerId) => {
        // If peer already exists (shouldn't happen normally) reuse it
        let peer = peersRef.current[callerId];
        if (!peer) peer = buildPeer(callerId);

        // Guard: ignore if already set
        if (peer.signalingState !== "stable" && peer.signalingState !== "have-remote-offer") return;

        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        await flushCandidates(callerId);

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        safeSend({ type: "answer", answer, caller_id: user.id, target_id: callerId });
    }, [buildPeer, flushCandidates, safeSend, user.id]);

    const handleAnswer = useCallback(async (answer, callerId) => {
        const peer = peersRef.current[callerId];
        if (!peer || peer.signalingState !== "have-local-offer") return;
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
        await flushCandidates(callerId);
    }, [flushCandidates]);

    const handleCandidate = useCallback(async ({ candidate, caller_id }) => {
        const peer = peersRef.current[caller_id];
        if (!peer || !peer.remoteDescription) {
            // Queue until remoteDescription is set
            (candidateQueue.current[caller_id] ??= []).push(candidate);
            return;
        }
        try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { console.warn(e); }
    }, []);

    const removePeer = useCallback((id) => {
        peersRef.current[id]?.close();
        delete peersRef.current[id];
        delete remoteStreamsRef.current[id];
        setParticipants(prev => prev.filter(p => p.id !== id));
    }, []);

    // ── Main effect: media + websocket ────────────────────────────────────────
    useEffect(() => {
        let mounted = true;
        let ws = null;

        const start = async () => {
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            } catch {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
                    setIsVideoOn(false);
                } catch {
                    stream = new MediaStream();
                    setIsVideoOn(false);
                    setIsMicOn(false);
                }
            }

            if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }

            localStreamRef.current = stream;
            if (localVideoRef.current) localVideoRef.current.srcObject = stream;

            ws = new WebSocket(
                `wss://snappier-reapply-kieth.ngrok-free.dev/ws/meeting/${meetingId}/`
            );
            wsRef.current = ws;

            ws.onopen = () => safeSend({ type: "join-room", user_id: user.id, name: user.name });

            ws.onmessage = async (event) => {
                const data = JSON.parse(event.data);
                console.log("WS ▶", data.type, data);
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
                        await handleAnswer(data.answer, data.caller_id);
                        break;
                    case "ice-candidate":
                        await handleCandidate(data);
                        break;
                    case "user-disconnected":
                        removePeer(data.user_id);
                        break;
                }
            };

            ws.onerror = (e) => console.error("WS error", e);
            ws.onclose = () => console.log("WS closed");
        };

        start();

        return () => {
            mounted = false;
            ws?.close();
            localStreamRef.current?.getTracks().forEach(t => t.stop());
            Object.values(peersRef.current).forEach(p => p.close());
            peersRef.current     = {};
            remoteStreamsRef.current = {};
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [meetingId]);

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="meet-container">

            {/* Floating emoji reactions */}
            <div className="meet-reactions-stage">
                {reactions.map(r => (
                    <span key={r.id} className="meet-reaction-bubble" style={{ left: `${r.x}%` }}>
                        {r.emoji}
                    </span>
                ))}
            </div>

            <div className="meet-main">

                <div className="meet-grid">

                    {/* Local tile */}
                    <div className="meet-tile">
                        <video
                            ref={localVideoRef}
                            className={`meet-video${isScreenSharing ? "" : " flipped"}`}
                            autoPlay muted playsInline
                        />
                        {isHandRaised && <div className="meet-hand-badge">✋</div>}
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

                {/* Participants panel */}
                {showParticipants && (
                    <div className="meet-side-panel">
                        <div className="meet-panel-header">
                            <span>People ({participants.length + 1})</span>
                            <button className="meet-panel-close" onClick={() => setShowParticipants(false)}>
                                <X size={18} />
                            </button>
                        </div>
                        <ul className="meet-panel-list">
                            <li className="meet-panel-item">
                                <div className="meet-avatar" style={{ background: "#1a73e8" }}>
                                    {(user.name || "Y")[0].toUpperCase()}
                                </div>
                                <span>{user.name || "You"} <em>(You)</em></span>
                                {isHandRaised && <span className="meet-hand-icon">✋</span>}
                            </li>
                            {participants.map(p => (
                                <li className="meet-panel-item" key={p.id}>
                                    <div className="meet-avatar" style={{ background: "#34a853" }}>P</div>
                                    <span>Participant {String(p.id).substring(0, 6)}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Chat panel */}
                {showChat && (
                    <div className="meet-side-panel">
                        <div className="meet-panel-header">
                            <span>In-call messages</span>
                            <button className="meet-panel-close" onClick={() => setShowChat(false)}>
                                <X size={18} />
                            </button>
                        </div>
                        <div className="meet-chat-messages">
                            {chatMessages.length === 0 && (
                                <p className="meet-chat-empty">No messages yet. Say hello! 👋</p>
                            )}
                            {chatMessages.map(m => (
                                <div key={m.id} className={`meet-chat-msg ${m.own ? "own" : ""}`}>
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
                                onKeyDown={e => e.key === "Enter" && sendChat()}
                            />
                            <button className="meet-chat-send" onClick={sendChat}><Send size={16} /></button>
                        </div>
                    </div>
                )}

            </div>

            {/* Bottom bar */}
            <div className="meet-bottom-bar">

                <div className="meet-bar-left">
                    {currentTime} | {String(meetingId).substring(0, 11)}…
                </div>

                <div className="meet-bar-center">

                    <button className={`meet-btn ${!isMicOn ? "active-red" : ""}`} onClick={toggleMic} title="Microphone">
                        {isMicOn ? <Mic size={20} /> : <MicOff size={20} />}
                    </button>

                    <button className={`meet-btn ${!isVideoOn ? "active-red" : ""}`} onClick={toggleVideo} title="Camera">
                        {isVideoOn ? <VideoIcon size={20} /> : <VideoOff size={20} />}
                    </button>

                    <button
                        className={`meet-btn ${isScreenSharing ? "active-blue" : ""}`}
                        onClick={toggleScreenShare}
                        title={isScreenSharing ? "Stop presenting" : "Present now"}
                    >
                        {isScreenSharing ? <MonitorX size={20} /> : <MonitorUp size={20} />}
                    </button>

                    <button
                        className={`meet-btn ${isHandRaised ? "active-yellow" : ""}`}
                        onClick={toggleHand}
                        title={isHandRaised ? "Lower hand" : "Raise hand"}
                    >
                        <Hand size={20} />
                    </button>

                    <div style={{ position: "relative" }}>
                        <button className="meet-btn" onClick={() => setShowEmojiPicker(v => !v)} title="React">
                            <span style={{ fontSize: 18 }}>😊</span>
                        </button>
                        {showEmojiPicker && (
                            <div className="meet-emoji-picker">
                                {EMOJIS.map(e => (
                                    <button key={e} className="meet-emoji-btn" onClick={() => sendReaction(e)}>{e}</button>
                                ))}
                            </div>
                        )}
                    </div>

                    <button className="meet-btn" title="Captions"><Captions size={20} /></button>
                    <button className="meet-btn" title="More"><MoreVertical size={20} /></button>

                    <button className="meet-btn-end" onClick={() => onLeave ? onLeave() : window.location.reload()}>
                        <Phone size={24} style={{ transform: "rotate(135deg)" }} />
                    </button>

                </div>

                <div className="meet-bar-right">
                    <button className="meet-small-btn" title="Meeting info"><Info size={20} /></button>
                    <button
                        className={`meet-small-btn ${showParticipants ? "active-panel" : ""}`}
                        title="People"
                        onClick={() => { setShowParticipants(v => !v); setShowChat(false); }}
                    >
                        <Users size={20} />
                    </button>
                    <button
                        className={`meet-small-btn ${showChat ? "active-panel" : ""}`}
                        title="Chat"
                        onClick={() => { setShowChat(v => !v); setShowParticipants(false); }}
                    >
                        <MessageSquare size={20} />
                    </button>
                </div>

            </div>
        </div>
    );
}

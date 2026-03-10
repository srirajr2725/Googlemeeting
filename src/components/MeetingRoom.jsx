import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Mic, MicOff, Video, VideoOff,
    Hand, MonitorUp, Smile, MoreVertical,
    PhoneOff, Info, Users, MessageSquare,
    Lock
} from 'lucide-react';

const MeetingRoom = ({ meetingId, onLeave, initialStream, initialMic, initialVideo, user }) => {
    const [micOn, setMicOn] = useState(initialMic);
    const [videoOn, setVideoOn] = useState(initialVideo);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [isHandRaised, setIsHandRaised] = useState(false);
    const [showReactions, setShowReactions] = useState(false);
    const [showChat, setShowChat] = useState(false);
    const [showParticipants, setShowParticipants] = useState(false);
    const [showDetails, setShowDetails] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);

    const [stream, setStream] = useState(initialStream);
    const videoRef = useRef(null);
    const peersRef = useRef({}); // Stores native RTCPeerConnections mapped by { userId: RTCPeerConnection }
    const wsRef = useRef(null);

    const rtcConfig = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
        ]
    };

    const [participants, setParticipants] = useState([
        { id: 'me', name: 'You', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix', raisedHand: false }
    ]);
    const [messages, setMessages] = useState([
        { id: 1, user: 'System', text: `Welcome to the meeting: ${meetingId}`, time: 'Live' }
    ]);
    const [newMessage, setNewMessage] = useState('');
    const [activeReactions, setActiveReactions] = useState([]);

    useEffect(() => {
        setParticipants([
            { id: 'me', name: user?.name || 'You', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix', raisedHand: false }
        ]);

        // Add a system welcome message
        setMessages(prev => [
            ...prev,
            { id: Date.now(), user: 'System', text: `You have joined room: ${meetingId}`, time: 'Now' }
        ]);

        // Connect to Django Channels WebSocket Endpoint
        // Adjust the wss:// URL if your Django routing differs (like /ws/chat/ or wss://localhost).
        const wsUrl = `wss://snappier-reapply-kieth.ngrok-free.dev/ws/meeting/${meetingId}/`;

        try {
            wsRef.current = new WebSocket(wsUrl);

            wsRef.current.onopen = () => {
                console.log('Connected to Signaling WebSocket');
                // Send a join broadcast
                wsRef.current.send(JSON.stringify({
                    type: 'join-room',
                    user_id: user?.id || 1,
                    name: user?.name || 'User'
                }));

                // Fetch existing participants currently in the room and aggressively initiate webRTC offers to them
                const fetchParticipantsAndConnect = async () => {
                    try {
                        const res = await fetch(`https://snappier-reapply-kieth.ngrok-free.dev/participants/list/${meetingId}/`);
                        if (res.ok) {
                            const data = await res.json();
                            const existingUsers = Array.isArray(data) ? data : (data.participants || data.users || []);
                            console.log('Fetched existing participants:', existingUsers);

                            if (existingUsers.length > 0) {
                                setParticipants(prev => {
                                    const newParticipants = [...prev];
                                    existingUsers.forEach(u => {
                                        const isString = typeof u === 'string';

                                        // Skip adding ourselves if returned by backend
                                        if (isString && u === user?.name) return;
                                        if (!isString && (u.user_id === user?.id || u.id === user?.id || u.name === user?.name)) return;

                                        // Fallbacks for various API structures
                                        const pId = isString ? u : (u.user_id || u.id || u.pk || u.name);
                                        const pName = isString ? u : (u.name || `User ${pId}`);
                                        if (!pId) return;

                                        // Prevent loading duplicate users from backend responses into the UI/Peer Mesh
                                        if (!newParticipants.find(p => p.id === pId || p.name === pName)) {
                                            newParticipants.push({
                                                id: pId,
                                                name: pName,
                                                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${pId}`,
                                                raisedHand: false
                                            });

                                            // 🚨 CRITICAL FIX: The current user MUST initiate WebRTC Offers to all pre-existing users to establish mesh!
                                            createPeerConnection(pId, true);
                                        }
                                    });
                                    return newParticipants;
                                });
                            }
                        }
                    } catch (err) {
                        console.warn('Failed to fetch initial participant list:', err);
                    }
                };

                fetchParticipantsAndConnect();
            };

            wsRef.current.onmessage = async (event) => {
                const message = JSON.parse(event.data);
                console.log('Received via WebSocket:', message.type);

                switch (message.type) {
                    case 'user-connected':
                        // Another user joined. We (as the existing user) should initiate an Offer
                        createPeerConnection(message.user_id, true);
                        break;

                    case 'offer':
                        // We received an offer from somebody else. We need to create a peer to Answer it.
                        await handleReceiveOffer(message.offer, message.caller_id);
                        break;

                    case 'answer':
                        // We received an answer to an offer we sent.
                        const activePeer = peersRef.current[message.caller_id];
                        if (activePeer) {
                            await activePeer.setRemoteDescription(new RTCSessionDescription(message.answer));
                        }
                        break;

                    case 'ice-candidate':
                        const icPeer = peersRef.current[message.caller_id];
                        if (icPeer && message.candidate) {
                            await icPeer.addIceCandidate(new RTCIceCandidate(message.candidate));
                        }
                        break;

                    case 'user-disconnected':
                        removePeer(message.user_id);
                        break;

                    default:
                        break;
                }
            };

            wsRef.current.onerror = (error) => {
                console.warn('WebSocket signaling error:', error);
            };

        } catch (e) {
            console.error('Failed to establish WebRTC Socket', e);
        }

        // Cleanup on unmount
        return () => {
            if (wsRef.current) wsRef.current.close();
            Object.values(peersRef.current).forEach(peer => peer.close());
            peersRef.current = {};
        };
    }, [meetingId, stream]); // Depend on stream so we can pass it to RTCPeerConnection

    // --- WebRTC Native Peer Logic ---

    // Generalized function to setup an RTCPeerConnection for a specific remote user
    const setupPeerConnection = (remoteUserId) => {
        console.log(`[WebRTC] Setting up RTCPeerConnection for user: ${remoteUserId}`);
        const peer = new RTCPeerConnection(rtcConfig);

        // Add local tracks to the connection
        if (stream) {
            console.log(`[WebRTC] Adding local stream tracks for user: ${remoteUserId}`);
            stream.getTracks().forEach(track => {
                peer.addTrack(track, stream);
            });
        }

        // Handle incoming ICE candidates generated by the local browser
        peer.onicecandidate = (event) => {
            if (event.candidate && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                console.log(`[WebRTC] Generated ICE candidate for ${remoteUserId}, sending...`);
                wsRef.current.send(JSON.stringify({
                    type: 'ice-candidate',
                    candidate: event.candidate,
                    target_id: remoteUserId,
                    caller_id: user?.id || 1
                }));
            }
        };

        peer.onconnectionstatechange = () => {
            console.log(`[WebRTC] Connection state with ${remoteUserId}: ${peer.connectionState}`);
        };

        peer.oniceconnectionstatechange = () => {
            console.log(`[WebRTC] ICE Connection state with ${remoteUserId}: ${peer.iceConnectionState}`);
        };

        // Handle incoming remote media streams resolving (the final video feed)
        peer.ontrack = (event) => {
            console.log(`[WebRTC] Received remote track from ${remoteUserId}!`, event.streams[0]);
            const remoteStream = event.streams[0];
            addParticipantVideo(remoteUserId, remoteStream);
        };

        peersRef.current[remoteUserId] = peer;
        return peer;
    };


    const createPeerConnection = async (remoteUserId, initiator) => {
        const peer = setupPeerConnection(remoteUserId);

        if (initiator) {
            try {
                console.log(`[WebRTC] Creating Offer for ${remoteUserId}...`);
                const offer = await peer.createOffer();
                await peer.setLocalDescription(offer);
                console.log(`[WebRTC] Offer created and set as local description for ${remoteUserId}.`);

                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({
                        type: 'offer',
                        offer: peer.localDescription,
                        target_id: remoteUserId,
                        caller_id: user?.id || 1
                    }));
                }
            } catch (err) {
                console.error("[WebRTC] Error generating offer", err);
            }
        }
    };

    const handleReceiveOffer = async (incomingOffer, callerId) => {
        const peer = setupPeerConnection(callerId);

        try {
            console.log(`[WebRTC] Received Offer from ${callerId}. Setting remote description...`);
            await peer.setRemoteDescription(new RTCSessionDescription(incomingOffer));

            console.log(`[WebRTC] Creating Answer for ${callerId}...`);
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            console.log(`[WebRTC] Answer created and set as local description for ${callerId}.`);

            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                    type: 'answer',
                    answer: peer.localDescription,
                    target_id: callerId,
                    caller_id: user?.id || 1
                }));
            }
        } catch (err) {
            console.error("[WebRTC] Error handling offer/generating answer", err);
        }
    };

    const addParticipantVideo = (userId, incomingStream) => {
        console.log(`[UI] Adding/Updating video tile for user: ${userId}. Has stream:`, !!incomingStream);
        if (incomingStream) {
            console.log(`[UI] Stream Tracks for ${userId}:`, incomingStream.getTracks().map(t => `${t.kind} (${t.readyState})`));
        }

        setParticipants(prev => {
            const existingIdx = prev.findIndex(p => p.id === userId);

            if (existingIdx >= 0) {
                // User tile already exists (maybe from the initial fetch list). Update it to attach the stream!
                console.log(`[UI] Updating existing user tile ${userId} with video stream.`);
                const updated = [...prev];
                updated[existingIdx] = { ...updated[existingIdx], stream: incomingStream };
                return updated;
            }

            // User tile didn't exist yet, create it fresh.
            console.log(`[UI] Creating new DOM tile for user ${userId}.`);
            return [...prev, {
                id: userId,
                name: `User ${userId}`,
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
                stream: incomingStream,
                raisedHand: false
            }];
        });
    };

    const removePeer = (userId) => {
        const peerObj = peersRef.current[userId];
        if (peerObj) peerObj.close();
        delete peersRef.current[userId];
        setParticipants(prev => prev.filter(p => p.id !== userId));
    };


    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream, videoOn, isScreenSharing]);

    useEffect(() => {
        if (stream) {
            stream.getVideoTracks().forEach(track => track.enabled = videoOn);
            stream.getAudioTracks().forEach(track => track.enabled = micOn);
        }
    }, [videoOn, micOn, stream]);

    const handleScreenShare = async () => {
        try {
            if (!isScreenSharing) {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                setStream(screenStream);
                setIsScreenSharing(true);



                screenStream.getVideoTracks()[0].onended = () => {
                    setIsScreenSharing(false);
                    setStream(initialStream);

                };
            } else {
                stream.getTracks().forEach(track => track.stop());
                setStream(initialStream);
                setIsScreenSharing(false);
            }
        } catch (err) {
            console.error("Error sharing screen:", err);
        }
    };

    const handleReaction = (emoji) => {
        const id = Date.now();
        setActiveReactions(prev => [...prev, { id, emoji }]);
        setTimeout(() => setActiveReactions(prev => prev.filter(r => r.id !== id)), 3000);
        setShowReactions(false);
    };

    const handleSendMessage = (e) => {
        e.preventDefault();
        if (!newMessage.trim()) return;

        const chatMsg = {
            id: Date.now(),
            user: 'You',
            text: newMessage,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages(prev => [...prev, chatMsg]); // Static room - update locally
        setNewMessage('');
    };

    return (
        <div className="meeting-room">
            <div className="main-area">
                <div className={`video-grid ${showChat || showParticipants ? 'sidebar-open' : ''} ${participants.length <= 1 ? 'single-participant' : ''}`}>
                    {participants.map((p) => (
                        <div key={p.id} className={`video-tile ${p.raisedHand ? 'raised-hand-border' : ''}`}>
                            {p.id === 'me' ? (
                                <div className="video-placeholder user-video">
                                    {(videoOn || isScreenSharing) ? (
                                        <video
                                            ref={videoRef}
                                            autoPlay
                                            playsInline
                                            muted
                                            className={isScreenSharing ? '' : 'mirrored'}
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        />
                                    ) : (
                                        <div className="video-off-state">
                                            <img src={p.avatar} alt={p.name} className="avatar-large" />
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="video-placeholder">
                                    {p.stream ? (
                                        <video
                                            autoPlay
                                            playsInline
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                            ref={video => {
                                                if (video && video.srcObject !== p.stream) {
                                                    video.srcObject = p.stream;
                                                }
                                            }}
                                        />
                                    ) : (
                                        <div className="remote-user-placeholder">
                                            <img src={p.avatar} alt={p.name} className="avatar-large" />
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="participant-info">
                                <span className="participant-name">{p.name} {p.id === 'me' && '(You)'}</span>
                                {p.raisedHand && <Hand size={16} className="hand-icon-indicator" />}
                            </div>
                            <div className="mic-indicator">
                                {p.id === 'me' ? (micOn ? <Mic size={14} /> : <MicOff size={14} className="error" />) : <Mic size={14} />}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Reactions floating overlay */}
                <div className="reactions-container">
                    <AnimatePresence>
                        {activeReactions.map(r => (
                            <motion.div
                                key={r.id}
                                initial={{ y: 0, opacity: 0, scale: 0.5 }}
                                animate={{ y: -200, opacity: 1, scale: 1.5 }}
                                exit={{ opacity: 0 }}
                                className="floating-reaction"
                            >
                                {r.emoji}
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>

                <AnimatePresence>
                    {(showChat || showParticipants) && (
                        <motion.div
                            className="side-panel"
                            initial={{ x: 400 }}
                            animate={{ x: 0 }}
                            exit={{ x: 400 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        >
                            <div className="panel-header">
                                <h3>{showChat ? 'In-call messages' : 'People'}</h3>
                                <button className="close-panel" onClick={() => { setShowChat(false); setShowParticipants(false); }}>
                                    <MoreVertical size={20} />
                                </button>
                            </div>

                            {showChat && (
                                <div className="chat-content">
                                    <div className="messages-list">
                                        {messages.map(m => (
                                            <div key={m.id} className="message-item">
                                                <div className="message-top">
                                                    <span className="sender">{m.user}</span>
                                                    <span className="time">{m.time}</span>
                                                </div>
                                                <p className="message-text">{m.text}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <form className="message-input" onSubmit={handleSendMessage}>
                                        <input
                                            type="text"
                                            placeholder="Send a message to everyone"
                                            value={newMessage}
                                            onChange={(e) => setNewMessage(e.target.value)}
                                        />
                                        <button type="submit"><MessageSquare size={20} /></button>
                                    </form>
                                </div>
                            )}

                            {showParticipants && (
                                <div className="participants-content">
                                    <button className="add-people-btn"><Users size={18} /> Add people</button>
                                    <div className="participants-list">
                                        {participants.map(p => (
                                            <div key={p.id} className="participant-row">
                                                <img src={p.avatar} alt={p.name} className="avatar-small" />
                                                <span>{p.name}</span>
                                                <div className="row-actions">
                                                    <Mic size={16} />
                                                    <MoreVertical size={16} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>

                <AnimatePresence>
                    {showDetails && (
                        <motion.div
                            className="details-panel glass-morphism"
                            initial={{ opacity: 0, y: 50, scale: 0.9 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 50, scale: 0.9 }}
                        >
                            <div className="details-header">
                                <h3>Meeting details</h3>
                                <button className="close-btn" onClick={() => setShowDetails(false)}>✕</button>
                            </div>
                            <div className="details-body">
                                <p className="label">Joining info</p>
                                <div className="link-box">
                                    <span className="meeting-url">{`${window.location.origin}/?room=${meetingId}`}</span>
                                    <button
                                        className={`copy-icon-btn ${copySuccess ? 'success' : ''}`}
                                        onClick={() => {
                                            navigator.clipboard.writeText(`${window.location.origin}/?room=${meetingId}`);
                                            setCopySuccess(true);
                                            setTimeout(() => setCopySuccess(false), 2000);
                                        }}
                                    >
                                        {copySuccess ? '✓' : 'Copy'}
                                    </button>
                                </div>
                                <div className="detail-meta">
                                    <p>Connected Peers: <span className="blue">{participants.length - 1}</span></p>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <footer className="meeting-controls">
                <div className="left-controls">
                    <div className="meeting-id-display">
                        {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} | {meetingId}
                    </div>
                </div>

                <div className="center-controls">
                    <button
                        className={`control-btn ${!micOn ? 'danger' : ''}`}
                        title={micOn ? "Mute mic" : "Unmute mic"}
                        onClick={() => setMicOn(!micOn)}
                    >
                        {micOn ? <Mic size={20} /> : <MicOff size={20} />}
                    </button>
                    <button
                        className={`control-btn ${!videoOn ? 'danger' : ''}`}
                        title={videoOn ? "Turn off camera" : "Turn on camera"}
                        onClick={() => setVideoOn(!videoOn)}
                    >
                        {videoOn ? <Video size={20} /> : <VideoOff size={20} />}
                    </button>
                    <button
                        className={`control-btn ${isHandRaised ? 'active' : ''}`}
                        title="Raise hand"
                        onClick={() => setIsHandRaised(!isHandRaised)}
                    >
                        <Hand size={20} />
                    </button>
                    <button
                        className={`control-btn ${isScreenSharing ? 'active' : ''}`}
                        title="Present now"
                        onClick={handleScreenShare}
                    >
                        <MonitorUp size={20} />
                    </button>
                    <div className="relative-container">
                        <button
                            className="control-btn"
                            title="Send a reaction"
                            onClick={() => setShowReactions(!showReactions)}
                        >
                            <Smile size={20} />
                        </button>
                        {showReactions && (
                            <div className="reactions-menu glass-morphism">
                                {['💖', '👍', '🎉', '👏', '😂', '😮', '😢', '🤔'].map(emoji => (
                                    <button key={emoji} onClick={() => handleReaction(emoji)}>{emoji}</button>
                                ))}
                            </div>
                        )}
                    </div>
                    <button className="control-btn" title="More options"><MoreVertical size={20} /></button>
                    <button className="control-btn leave-btn" title="Leave call" onClick={onLeave}>
                        <PhoneOff size={20} />
                    </button>
                </div>

                <div className="right-controls">
                    <button
                        className={`icon-btn ${showDetails ? 'active' : ''}`}
                        title="Meeting details"
                        onClick={() => setShowDetails(!showDetails)}
                    >
                        <Info size={20} />
                    </button>
                    <button
                        className={`icon-btn ${showParticipants ? 'active' : ''}`}
                        title="Show everyone"
                        onClick={() => { setShowParticipants(!showParticipants); setShowChat(false); }}
                    >
                        <Users size={20} />
                    </button>
                    <button
                        className={`icon-btn ${showChat ? 'active' : ''}`}
                        title="Chat with everyone"
                        onClick={() => { setShowChat(!showChat); setShowParticipants(false); }}
                    >
                        <MessageSquare size={20} />
                        {messages.length > 2 && <span className="badge" />}
                    </button>
                    <button className="icon-btn" title="Activities"><Lock size={20} /></button>
                </div>
            </footer>
        </div>
    );
};

export default MeetingRoom;

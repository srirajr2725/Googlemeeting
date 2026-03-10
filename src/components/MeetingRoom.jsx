import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video as VideoIcon, VideoOff, Phone, MonitorUp, MoreVertical, Users } from "lucide-react";
import './MeetingRoom.css';

const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

export default function MeetingRoom({ meetingId, user, onLeave }) {

    const wsRef = useRef(null);
    const peersRef = useRef({});
    const candidateQueue = useRef({});
    const localStreamRef = useRef(null);
    const localVideoRef = useRef(null);

    const [participants, setParticipants] = useState([]);

    // UI state for bottom controls
    const [isMicOn, setIsMicOn] = useState(true);
    const [isVideoOn, setIsVideoOn] = useState(true);

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

    useEffect(() => {

        const start = async () => {

            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });

            localStreamRef.current = stream;
            localVideoRef.current.srcObject = stream;

            const ws = new WebSocket(
                `wss://snappier-reapply-kieth.ngrok-free.dev/ws/meeting/${meetingId}/`
            );

            wsRef.current = ws;

            ws.onopen = () => {

                ws.send(JSON.stringify({
                    type: "join-room",
                    user_id: user.id,
                    name: user.name
                }));

            };

            ws.onmessage = async (event) => {

                const data = JSON.parse(event.data);
                console.log("WS EVENT:", data);

                switch (data.type) {

                    case "existing-users":

                        data.users.forEach(u => {
                            if (u.user_id !== user.id) {
                                createPeer(u.user_id, true);
                            }
                        });

                        break;

                    case "user-connected":

                        if (data.user_id !== user.id) {
                            createPeer(data.user_id, true);
                        }

                        break;

                    case "offer":

                        await handleOffer(data.offer, data.caller_id);

                        break;

                    case "answer":

                        const peer = peersRef.current[data.caller_id];

                        if (!peer) return;

                        await peer.setRemoteDescription(
                            new RTCSessionDescription(data.answer)
                        );

                        flushCandidates(data.caller_id);

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

    }, []);

    const createPeer = async (remoteId, initiator = false) => {

        if (peersRef.current[remoteId]) return;

        const peer = new RTCPeerConnection(rtcConfig);
        peersRef.current[remoteId] = peer;

        localStreamRef.current.getTracks().forEach(track => {
            peer.addTrack(track, localStreamRef.current);
        });

        peer.ontrack = (event) => {

            const remoteStream = event.streams[0];

            setParticipants(prev => {

                const exists = prev.find(p => p.id === remoteId);

                if (exists) {
                    return prev.map(p =>
                        p.id === remoteId ? { ...p, stream: remoteStream } : p
                    );
                }

                return [...prev, { id: remoteId, stream: remoteStream }];

            });

        };

        peer.onicecandidate = (event) => {

            if (!event.candidate) return;

            wsRef.current.send(JSON.stringify({
                type: "ice-candidate",
                candidate: event.candidate,
                caller_id: user.id,
                target_id: remoteId
            }));

        };

        if (initiator) {

            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);

            wsRef.current.send(JSON.stringify({
                type: "offer",
                offer,
                caller_id: user.id,
                target_id: remoteId
            }));

        }

    };

    const handleOffer = async (offer, callerId) => {

        const peer = new RTCPeerConnection(rtcConfig);
        peersRef.current[callerId] = peer;

        localStreamRef.current.getTracks().forEach(track => {
            peer.addTrack(track, localStreamRef.current);
        });

        peer.ontrack = (event) => {

            const remoteStream = event.streams[0];

            setParticipants(prev => {

                const exists = prev.find(p => p.id === callerId);

                if (exists) {
                    return prev.map(p =>
                        p.id === callerId ? { ...p, stream: remoteStream } : p
                    );
                }

                return [...prev, { id: callerId, stream: remoteStream }];

            });

        };

        peer.onicecandidate = (event) => {

            if (!event.candidate) return;

            wsRef.current.send(JSON.stringify({
                type: "ice-candidate",
                candidate: event.candidate,
                caller_id: user.id,
                target_id: callerId
            }));

        };

        await peer.setRemoteDescription(
            new RTCSessionDescription(offer)
        );

        flushCandidates(callerId);

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        wsRef.current.send(JSON.stringify({
            type: "answer",
            answer,
            caller_id: user.id,
            target_id: callerId
        }));

    };

    const handleCandidate = async (data) => {

        const peer = peersRef.current[data.caller_id];

        if (!peer || !peer.remoteDescription) {

            if (!candidateQueue.current[data.caller_id]) {
                candidateQueue.current[data.caller_id] = [];
            }

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
            await peer.addIceCandidate(new RTCIceCandidate(candidate));
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
        <div className="meeting-container">
            {/* Header */}
            <div className="meeting-header">
                <div className="meeting-info">
                    <span className="meeting-title">Raanuva Veeran Meet</span>
                    <span className="meeting-id">{meetingId}</span>
                </div>
                <div className="participant-count">
                    <Users size={18} />
                    <span>{participants.length + 1}</span>
                </div>
            </div>

            {/* Video Grid */}
            <div className="video-grid-container">
                <div className="video-grid">
                    {/* Local Video */}
                    <div className="video-tile">
                        <video
                            ref={localVideoRef}
                            className="video-element"
                            style={{ transform: 'scaleX(-1)' }}
                            autoPlay
                            muted
                            playsInline
                        />
                        <div className="participant-label">
                            {!isMicOn && <MicOff size={16} color="#ff5252" />}
                            You
                        </div>
                    </div>

                    {/* Remote Videos */}
                    {participants.map(p => (
                        <div className="video-tile" key={p.id}>
                            <video
                                className="video-element remote"
                                autoPlay
                                playsInline
                                ref={(video) => {
                                    if (video && video.srcObject !== p.stream) {
                                        video.srcObject = p.stream;
                                    }
                                }}
                            />
                            <div className="participant-label">
                                Participant {p.id.toString().substring(0, 4)}...
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Bottom Controls */}
            <div className="controls-container">
                <div className="controls-bar">
                    <button
                        className={`control-btn ${!isMicOn ? 'active' : ''}`}
                        onClick={toggleMic}
                        title={isMicOn ? "Turn off microphone" : "Turn on microphone"}
                    >
                        {isMicOn ? <Mic size={22} /> : <MicOff size={22} />}
                    </button>

                    <button
                        className={`control-btn ${!isVideoOn ? 'active' : ''}`}
                        onClick={toggleVideo}
                        title={isVideoOn ? "Turn off camera" : "Turn on camera"}
                    >
                        {isVideoOn ? <VideoIcon size={22} /> : <VideoOff size={22} />}
                    </button>

                    <button className="control-btn" title="Present now">
                        <MonitorUp size={22} />
                    </button>

                    <button className="control-btn" title="More options">
                        <MoreVertical size={22} />
                    </button>

                    <button
                        className="control-btn end-call"
                        onClick={() => onLeave && onLeave()}
                        title="Leave call"
                    >
                        <Phone size={24} style={{ transform: 'rotate(135deg)' }} />
                    </button>
                </div>
            </div>
        </div>
    );

}
import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video as VideoIcon, VideoOff, Phone, MonitorUp, MoreVertical, MessageSquare, Users, Info, Captions, Hand } from "lucide-react";
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

    const [isMicOn, setIsMicOn] = useState(true);
    const [isVideoOn, setIsVideoOn] = useState(true);
    const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));


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


    useEffect(() => {

        const start = async () => {

            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });

            localStreamRef.current = stream;

            if (localVideoRef.current)
                localVideoRef.current.srcObject = stream;


            const ws = new WebSocket(
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

            safeSend({
                type: "ice-candidate",
                candidate: event.candidate,
                caller_id: user.id,
                target_id: remoteId
            });

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
            <div className="meet-main">
                <div className="meet-grid">

                    <div className="meet-tile">
                        <video
                            ref={localVideoRef}
                            className="meet-video flipped"
                            autoPlay
                            muted
                            playsInline
                        />

                        <div className="meet-label">
                            {!isMicOn && (
                                <div className="meet-mic-indicator muted">
                                    <MicOff size={14} color="white" />
                                </div>
                            )}
                            You
                        </div>
                    </div>

                    {participants.map(p => (
                        <div className="meet-tile" key={p.id}>
                            <video
                                className="meet-video"
                                autoPlay
                                playsInline
                                ref={(video) => {
                                    if (video && video.srcObject !== p.stream) {
                                        video.srcObject = p.stream;
                                    }
                                }}
                            />
                            <div className="meet-label">
                                <div className="meet-mic-indicator">
                                    <Mic size={14} color="white" />
                                </div>
                                Participant {p.id.toString().substring(0, 4)}...
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="meet-bottom-bar">

                <div className="meet-bar-left">
                    {currentTime} | {meetingId.substring(0, 11)}...
                </div>

                <div className="meet-bar-center">

                    <button className={`meet-btn ${!isMicOn ? 'active-red' : ''}`} onClick={toggleMic}>
                        {isMicOn ? <Mic size={20} /> : <MicOff size={20} />}
                    </button>

                    <button className={`meet-btn ${!isVideoOn ? 'active-red' : ''}`} onClick={toggleVideo}>
                        {isVideoOn ? <VideoIcon size={20} /> : <VideoOff size={20} />}
                    </button>

                    <button className="meet-btn">
                        <Captions size={20} />
                    </button>

                    <button className="meet-btn">
                        <Hand size={20} />
                    </button>

                    <button className="meet-btn">
                        <MonitorUp size={20} />
                    </button>

                    <button className="meet-btn">
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
                    <button className="meet-small-btn">
                        <Info size={20} />
                    </button>
                    <button className="meet-small-btn">
                        <Users size={20} />
                    </button>
                    <button className="meet-small-btn">
                        <MessageSquare size={20} />
                    </button>
                </div>

            </div>
        </div>
    );

}
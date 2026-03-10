import React, { useEffect, useRef, useState } from "react";

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" }
  ]
};

export default function MeetingRoom({ meetingId, user }) {

  const localVideoRef = useRef(null);
  const wsRef = useRef(null);
  const peersRef = useRef({}); // stores RTCPeerConnections keyed by userId

  const [participants, setParticipants] = useState([]);
  const [stream, setStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";

  // --- Initialize camera/mic ---
  const initMedia = async () => {
    const media = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    setStream(media);

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = media;
    }

    return media;
  };

  // --- WebRTC + WebSocket setup ---
  useEffect(() => {
    let localStream;

    const startMeeting = async () => {
      localStream = await initMedia();

      const ws = new WebSocket(
        `${protocol}://${window.location.host}/ws/meeting/${meetingId}/`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        // Join room
        ws.send(JSON.stringify({
          type: "join-room",
          user_id: user.id,
          name: user.name
        }));
      };

      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {

          case "existing-users":
            data.users.forEach((u) => {
              if (u.user_id !== user.id && !peersRef.current[u.user_id]) {
                createPeerConnection(u.user_id, true);
              }
            });
            break;

          case "user-connected":
            if (data.user_id !== user.id && !peersRef.current[data.user_id]) {
              createPeerConnection(data.user_id, true);
            }
            break;

          case "offer":
            await handleReceiveOffer(data.offer, data.caller_id);
            break;

          case "answer":
            const peer = peersRef.current[data.caller_id];
            if (peer) {
              await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
            break;

          case "ice-candidate":
            const icePeer = peersRef.current[data.caller_id];
            if (icePeer && data.candidate) {
              await icePeer.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
            break;

          case "user-disconnected":
            removePeer(data.user_id);
            break;

          default:
            break;
        }
      };
    };

    startMeeting();

    return () => {
      Object.values(peersRef.current).forEach(peer => peer.close());
      if (wsRef.current) wsRef.current.close();
      if (localStream) localStream.getTracks().forEach(track => track.stop());
    };
  }, []);

  // --- Create Peer Connection ---
  const createPeerConnection = async (remoteUserId, initiator = false) => {
    if (!stream) return;

    const peer = new RTCPeerConnection(rtcConfig);
    peersRef.current[remoteUserId] = peer;

    // Add local tracks
    stream.getTracks().forEach(track => peer.addTrack(track, stream));

    // ICE candidates
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        wsRef.current.send(JSON.stringify({
          type: "ice-candidate",
          candidate: event.candidate,
          caller_id: user.id,
          target_id: remoteUserId
        }));
      }
    };

    // Remote track
    peer.ontrack = (event) => {
      const remoteStream = event.streams[0];
      addParticipant(remoteUserId, remoteStream);
    };

    // Create Offer if initiator
    if (initiator) {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      wsRef.current.send(JSON.stringify({
        type: "offer",
        offer: offer,
        caller_id: user.id,
        target_id: remoteUserId
      }));
    }
  };

  // --- Handle incoming offer ---
  const handleReceiveOffer = async (offer, callerId) => {
    if (!stream) return;

    const peer = new RTCPeerConnection(rtcConfig);
    peersRef.current[callerId] = peer;

    stream.getTracks().forEach(track => peer.addTrack(track, stream));

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        wsRef.current.send(JSON.stringify({
          type: "ice-candidate",
          candidate: event.candidate,
          caller_id: user.id,
          target_id: callerId
        }));
      }
    };

    peer.ontrack = (event) => {
      addParticipant(callerId, event.streams[0]);
    };

    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    wsRef.current.send(JSON.stringify({
      type: "answer",
      answer: answer,
      caller_id: user.id,
      target_id: callerId
    }));
  };

  // --- Add participant ---
  const addParticipant = (userId, remoteStream) => {
    setParticipants(prev => {
      const exists = prev.find(p => p.id === userId);
      if (exists) {
        return prev.map(p =>
          p.id === userId ? { ...p, stream: remoteStream } : p
        );
      }
      return [...prev, { id: userId, stream: remoteStream }];
    });
  };

  // --- Remove participant ---
  const removePeer = (userId) => {
    const peer = peersRef.current[userId];
    if (peer) peer.close();
    delete peersRef.current[userId];
    setParticipants(prev => prev.filter(p => p.id !== userId));
  };

  // Toggle mic/video
  useEffect(() => {
    if (stream) {
      stream.getVideoTracks().forEach(track => track.enabled = videoOn);
      stream.getAudioTracks().forEach(track => track.enabled = micOn);
    }
  }, [micOn, videoOn, stream]);

  return (
    <div style={{ padding: 20 }}>
      <h2>Meeting Room: {meetingId}</h2>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, 300px)",
        gap: "10px"
      }}>
        {/* Local Video */}
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          style={{ border: "2px solid black", width: "300px" }}
        />

        {/* Remote Participants */}
        {participants.map(p => (
          <video
            key={p.id}
            autoPlay
            playsInline
            style={{ border: "2px solid blue", width: "300px" }}
            ref={video => {
              if (video && video.srcObject !== p.stream) {
                video.srcObject = p.stream;
              }
            }}
          />
        ))}
      </div>

      <div style={{ marginTop: 20 }}>
        <button onClick={() => setMicOn(!micOn)}>
          {micOn ? "Mute Mic" : "Unmute Mic"}
        </button>
        <button onClick={() => setVideoOn(!videoOn)}>
          {videoOn ? "Stop Video" : "Start Video"}
        </button>
      </div>
    </div>
  );
}
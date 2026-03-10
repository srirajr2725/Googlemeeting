import React, { useEffect, useRef, useState } from "react";

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

export default function MeetingRoom({ meetingId, user }) {

  const wsRef = useRef(null);
  const peersRef = useRef({});
  const candidateQueueRef = useRef({});

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);

  const [participants, setParticipants] = useState([]);

  useEffect(() => {

    const start = async () => {

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      stream.getAudioTracks().forEach(track => {
        track.enabled = true;
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
            p.id === remoteId
              ? { ...p, stream: remoteStream }
              : p
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
            p.id === callerId
              ? { ...p, stream: remoteStream }
              : p
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

      if (!candidateQueueRef.current[data.caller_id]) {
        candidateQueueRef.current[data.caller_id] = [];
      }

      candidateQueueRef.current[data.caller_id].push(data.candidate);

      return;

    }

    await peer.addIceCandidate(
      new RTCIceCandidate(data.candidate)
    );

  };

  const flushCandidates = async (peerId) => {

    const peer = peersRef.current[peerId];
    const queue = candidateQueueRef.current[peerId];

    if (!queue || !peer) return;

    for (const c of queue) {
      await peer.addIceCandidate(new RTCIceCandidate(c));
    }

    delete candidateQueueRef.current[peerId];

  };

  const removePeer = (id) => {

    if (!peersRef.current[id]) return;

    peersRef.current[id].close();
    delete peersRef.current[id];

    setParticipants(prev => prev.filter(p => p.id !== id));

  };

  return (

    <div>

      <h2>Meeting Room</h2>

      <h3>Your Camera</h3>

      <video
        ref={localVideoRef}
        autoPlay
        muted
        playsInline
        width="300"
      />

      <h3>Participants</h3>

      <div style={{ display: "flex", gap: 10 }}>

        {participants.map(p => (

          <video
            key={p.id}
            autoPlay
            playsInline
            controls
            width="300"
            ref={(video) => {
              if (video) video.srcObject = p.stream;
            }}
          />

        ))}

      </div>

    </div>

  );

}
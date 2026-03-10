import React, { useEffect, useRef, useState } from "react";

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

export default function MeetingRoom({ meetingId, user }) {

  const wsRef = useRef(null);
  const peersRef = useRef({});
  const candidateQueue = useRef({});
  const localVideoRef = useRef(null);
  const streamRef = useRef(null);

  const [participants, setParticipants] = useState([]);

  useEffect(() => {

    const start = async () => {

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      streamRef.current = stream;
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

            await receiveOffer(data.offer, data.caller_id);

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

        }

      };

    };

    start();

  }, []);

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

  const flushCandidates = async (id) => {

    const peer = peersRef.current[id];
    const queue = candidateQueue.current[id];

    if (!queue || !peer) return;

    for (const c of queue) {
      await peer.addIceCandidate(new RTCIceCandidate(c));
    }

    delete candidateQueue.current[id];

  };

  const createPeer = async (remoteId, initiator = false) => {

    if (peersRef.current[remoteId]) return;

    const peer = new RTCPeerConnection(rtcConfig);
    peersRef.current[remoteId] = peer;

    streamRef.current.getTracks().forEach(track => {
      peer.addTrack(track, streamRef.current);
    });

    peer.ontrack = (event) => {

      const stream = event.streams[0];

      setParticipants(prev => {

        if (prev.find(p => p.id === remoteId)) return prev;

        return [...prev, { id: remoteId, stream }];

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

  const receiveOffer = async (offer, callerId) => {

    if (peersRef.current[callerId]) return;

    const peer = new RTCPeerConnection(rtcConfig);
    peersRef.current[callerId] = peer;

    streamRef.current.getTracks().forEach(track => {
      peer.addTrack(track, streamRef.current);
    });

    peer.ontrack = (event) => {

      const stream = event.streams[0];

      setParticipants(prev => {

        if (prev.find(p => p.id === callerId)) return prev;

        return [...prev, { id: callerId, stream }];

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

  return (

    <div>

      <h2>Meeting Room</h2>

      <video
        ref={localVideoRef}
        autoPlay
        muted
        playsInline
        width="300"
      />

      <div style={{ display: "flex", gap: 10 }}>

        {participants.map(p => (

          <video
            key={p.id}
            autoPlay
            playsInline
            width="300"
            ref={video => {
              if (video) video.srcObject = p.stream;
            }}
          />

        ))}

      </div>

    </div>

  );

}
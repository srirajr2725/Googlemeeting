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
  const peersRef = useRef({});

  const [participants, setParticipants] = useState([]);
  const [stream, setStream] = useState(null);

  // Detect ws or wss automatically
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";

  // Start camera and mic
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

  useEffect(() => {

    let localStream;

    const startMeeting = async () => {

      localStream = await initMedia();

      const ws = new WebSocket(
        `${protocol}://${window.location.host}/ws/meeting/${meetingId}/`
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

        switch (data.type) {

          case "existing-users":

            data.users.forEach((u) => {

              if (u.user_id !== user.id) {
                createPeerConnection(u.user_id, true);
              }

            });

          break;


          case "user-connected":

            if (data.user_id !== user.id) {
              createPeerConnection(data.user_id, true);
            }

          break;


          case "offer":

            await handleReceiveOffer(data.offer, data.caller_id);

          break;


          case "answer":

            const peer = peersRef.current[data.caller_id];

            if (peer) {

              await peer.setRemoteDescription(
                new RTCSessionDescription(data.answer)
              );

            }

          break;


          case "ice-candidate":

            const icePeer = peersRef.current[data.caller_id];

            if (icePeer && data.candidate) {

              await icePeer.addIceCandidate(
                new RTCIceCandidate(data.candidate)
              );

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

    };

  }, []);


  // Create Peer Connection
  const createPeerConnection = async (remoteUserId, initiator=false) => {

    const peer = new RTCPeerConnection(rtcConfig);

    peersRef.current[remoteUserId] = peer;

    stream.getTracks().forEach(track => {
      peer.addTrack(track, stream);
    });

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

    peer.ontrack = (event) => {

      const remoteStream = event.streams[0];

      addParticipant(remoteUserId, remoteStream);

    };

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


  // Handle incoming offer
  const handleReceiveOffer = async (offer, callerId) => {

    const peer = new RTCPeerConnection(rtcConfig);

    peersRef.current[callerId] = peer;

    stream.getTracks().forEach(track => {
      peer.addTrack(track, stream);
    });

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

      const remoteStream = event.streams[0];

      addParticipant(callerId, remoteStream);

    };

    await peer.setRemoteDescription(
      new RTCSessionDescription(offer)
    );

    const answer = await peer.createAnswer();

    await peer.setLocalDescription(answer);

    wsRef.current.send(JSON.stringify({
      type: "answer",
      answer: answer,
      caller_id: user.id,
      target_id: callerId
    }));

  };


  // Add participant video
  const addParticipant = (userId, remoteStream) => {

    setParticipants(prev => {

      const exists = prev.find(p => p.id === userId);

      if (exists) {

        return prev.map(p =>
          p.id === userId
            ? { ...p, stream: remoteStream }
            : p
        );

      }

      return [
        ...prev,
        {
          id: userId,
          stream: remoteStream
        }
      ];

    });

  };


  // Remove user
  const removePeer = (userId) => {

    const peer = peersRef.current[userId];

    if (peer) peer.close();

    delete peersRef.current[userId];

    setParticipants(prev => prev.filter(p => p.id !== userId));

  };


  return (

    <div style={{ padding: "20px" }}>

      <h2>Meeting Room: {meetingId}</h2>

      {/* Local video */}

      <video
        ref={localVideoRef}
        autoPlay
        muted
        playsInline
        width="300"
        style={{ border: "2px solid black", margin: "10px" }}
      />

      {/* Remote users */}

      <div style={{ display: "flex", flexWrap: "wrap" }}>

        {participants.map(p => (

          <video
            key={p.id}
            autoPlay
            playsInline
            width="300"
            style={{ border: "2px solid blue", margin: "10px" }}
            ref={video => {

              if (video && video.srcObject !== p.stream) {
                video.srcObject = p.stream;
              }

            }}
          />

        ))}

      </div>

    </div>

  );

}
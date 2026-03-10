import React, { useEffect, useRef, useState } from "react";

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ]
};

export default function MeetingRoom({ meetingId, user }) {

  const wsRef = useRef(null);
  const peersRef = useRef({});
  const localVideoRef = useRef(null);
  const streamRef = useRef(null);

  const [participants, setParticipants] = useState([]);

  useEffect(() => {

    const startMeeting = async () => {

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

        console.log("WebSocket connected");

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

                console.log("Creating offer to", u.user_id);

                createPeerConnection(u.user_id, true);

              }

            });

          break;


          case "user-connected":

            console.log("New user joined:", data.user_id);

            // DO NOT create offer here (prevents collision)

          break;


          case "offer":

            await handleOffer(data.offer, data.caller_id);

          break;


          case "answer":

            if (peersRef.current[data.caller_id]) {

              await peersRef.current[data.caller_id]
              .setRemoteDescription(
                new RTCSessionDescription(data.answer)
              );

            }

          break;


          case "ice-candidate":

            if (peersRef.current[data.caller_id]) {

              await peersRef.current[data.caller_id]
              .addIceCandidate(
                new RTCIceCandidate(data.candidate)
              );

            }

          break;


          case "user-disconnected":

            removePeer(data.user_id);

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




  const createPeerConnection = async (remoteId, initiator=false) => {

    if (peersRef.current[remoteId]) return;

    const peer = new RTCPeerConnection(rtcConfig);

    peersRef.current[remoteId] = peer;

    streamRef.current.getTracks().forEach(track => {
      peer.addTrack(track, streamRef.current);
    });

    peer.ontrack = (event) => {

      console.log("Received remote stream from", remoteId);

      addParticipant(remoteId, event.streams[0]);

    };

    peer.onicecandidate = (event) => {

      if (event.candidate) {

        wsRef.current.send(JSON.stringify({
          type: "ice-candidate",
          candidate: event.candidate,
          caller_id: user.id,
          target_id: remoteId
        }));

      }

    };

    if (initiator) {

      const offer = await peer.createOffer();

      await peer.setLocalDescription(offer);

      wsRef.current.send(JSON.stringify({
        type: "offer",
        offer: offer,
        caller_id: user.id,
        target_id: remoteId
      }));

    }

  };




  const handleOffer = async (offer, callerId) => {

    if (!peersRef.current[callerId]) {

      await createPeerConnection(callerId, false);

    }

    const peer = peersRef.current[callerId];

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




  const addParticipant = (id, stream) => {

    setParticipants(prev => {

      const exists = prev.find(p => p.id === id);

      if (exists) {

        return prev.map(p =>
          p.id === id ? { ...p, stream } : p
        );

      }

      return [...prev, { id, stream }];

    });

  };




  const removePeer = (id) => {

    if (peersRef.current[id]) {

      peersRef.current[id].close();

      delete peersRef.current[id];

    }

    setParticipants(prev =>
      prev.filter(p => p.id !== id)
    );

  };




  return (

    <div>

      <h2>Meeting Room {meetingId}</h2>

      <video
        ref={localVideoRef}
        autoPlay
        muted
        playsInline
        width="300"
      />

      <div style={{display:"flex",flexWrap:"wrap"}}>

        {participants.map(p => (

          <video
            key={p.id}
            autoPlay
            playsInline
            width="300"
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

import React,{useEffect,useRef,useState} from "react";

const rtcConfig={
iceServers:[
{urls:"stun:stun.l.google.com:19302"},
{
urls:"turn:googlemeetclone.metered.live:80",
username:"srirajr2725@gmail.com",
credential:"sriraj@2725"
}
]
};

export default function MeetingRoom({meetingId,user}){

const wsRef=useRef(null);
const peersRef=useRef({});
const localVideoRef=useRef(null);
const streamRef=useRef(null);

const [participants,setParticipants]=useState([]);

useEffect(()=>{

const start=async()=>{

const stream=await navigator.mediaDevices.getUserMedia({
video:true,
audio:true
});

streamRef.current=stream;

if(localVideoRef.current){
localVideoRef.current.srcObject=stream;
}

const ws=new WebSocket(
`wss://snappier-reapply-kieth.ngrok-free.dev/ws/meeting/${meetingId}/`
);

wsRef.current=ws;

ws.onopen=()=>{
ws.send(JSON.stringify({
type:"join-room",
user_id:user.id,
name:user.name
}));
};

ws.onmessage=async(event)=>{

const data=JSON.parse(event.data);

switch(data.type){

case "existing-users":

data.users.forEach(u=>{
if(u.user_id!==user.id){
createPeerConnection(u.user_id,true);
}
});

break;

case "user-connected":

if(data.user_id!==user.id){
createPeerConnection(data.user_id,true);
}

break;

case "offer":

await handleOffer(data.offer,data.caller_id);

break;

case "answer":

await peersRef.current[data.caller_id]
.setRemoteDescription(new RTCSessionDescription(data.answer));

break;

case "ice-candidate":

await peersRef.current[data.caller_id]
.addIceCandidate(new RTCIceCandidate(data.candidate));

break;

case "user-disconnected":

removePeer(data.user_id);

break;

}

};

};

start();

return()=>{

Object.values(peersRef.current).forEach(peer=>peer.close());

if(wsRef.current) wsRef.current.close();

};

},[]);

const createPeerConnection=async(remoteId,initiator=false)=>{

if(peersRef.current[remoteId]) return;

const peer=new RTCPeerConnection(rtcConfig);

peersRef.current[remoteId]=peer;

streamRef.current.getTracks().forEach(track=>{
peer.addTrack(track,streamRef.current);
});

peer.ontrack=(event)=>{
const remoteStream=event.streams[0];

setParticipants(prev=>{
const exists=prev.find(p=>p.id===remoteId);

if(exists){
return prev;
}

return [...prev,{id:remoteId,stream:remoteStream}];
});
};

peer.onicecandidate=(event)=>{

if(event.candidate){

wsRef.current.send(JSON.stringify({
type:"ice-candidate",
candidate:event.candidate,
caller_id:user.id,
target_id:remoteId
}));

}

};

if(initiator){

const offer=await peer.createOffer();

await peer.setLocalDescription(offer);

wsRef.current.send(JSON.stringify({
type:"offer",
offer:offer,
caller_id:user.id,
target_id:remoteId
}));

}

};

const handleOffer=async(offer,callerId)=>{

if(peersRef.current[callerId]) return;

const peer=new RTCPeerConnection(rtcConfig);

peersRef.current[callerId]=peer;

streamRef.current.getTracks().forEach(track=>{
peer.addTrack(track,streamRef.current);
});

peer.ontrack=(event)=>{
const remoteStream=event.streams[0];

setParticipants(prev=>{
const exists=prev.find(p=>p.id===callerId);

if(exists){
return prev;
}

return [...prev,{id:callerId,stream:remoteStream}];
});
};

peer.onicecandidate=(event)=>{

if(event.candidate){

wsRef.current.send(JSON.stringify({
type:"ice-candidate",
candidate:event.candidate,
caller_id:user.id,
target_id:callerId
}));

}

};

await peer.setRemoteDescription(new RTCSessionDescription(offer));

const answer=await peer.createAnswer();

await peer.setLocalDescription(answer);

wsRef.current.send(JSON.stringify({
type:"answer",
answer:answer,
caller_id:user.id,
target_id:callerId
}));

};

const removePeer=(id)=>{

if(peersRef.current[id]){
peersRef.current[id].close();
delete peersRef.current[id];
}

setParticipants(prev=>prev.filter(p=>p.id!==id));

};

return(

<div>

<h2>Meeting Room {meetingId}</h2>

<h3>Your Camera</h3>

<video
ref={localVideoRef}
autoPlay
muted
playsInline
width="300"
/>

<h3>Participants</h3>

<div style={{display:"flex",flexWrap:"wrap"}}>

{participants.map(p=>(

<video
key={p.id}
autoPlay
playsInline
width="300"
ref={video=>{
if(video && video.srcObject!==p.stream){
video.srcObject=p.stream;
}
}}
/>

))}

</div>

</div>

);

}
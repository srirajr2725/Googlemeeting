import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Video, VideoOff, Settings, MoreVertical } from 'lucide-react';
import { motion } from 'framer-motion';

const GreenRoom = ({ onJoin, onBack }) => {
    const [micOn, setMicOn] = useState(true);
    const [videoOn, setVideoOn] = useState(true);
    const [localStream, setLocalStream] = useState(null);
    const videoRef = useRef(null);

    useEffect(() => {
        const startMedia = async () => {
            try {
                const userStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true,
                });
                setLocalStream(userStream);
                if (videoRef.current) {
                    videoRef.current.srcObject = userStream;
                }
            } catch (err) {
                console.error('Error accessing media:', err);
            }
        };

        startMedia();

        return () => {
            // Don't stop tracks here if we are moving to the meeting,
            // but if we are going BACK, we should. App handles this now.
        };
    }, []);

    useEffect(() => {
        if (localStream) {
            localStream.getVideoTracks().forEach((track) => (track.enabled = videoOn));
            localStream.getAudioTracks().forEach((track) => (track.enabled = micOn));
        }
    }, [videoOn, micOn, localStream]);

    return (
        <div className="green-room-container">
            <div className="green-room-main">
                <div className="preview-area">
                    <div className="video-preview-box">
                        {videoOn ? (
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className="preview-video"
                            />
                        ) : (
                            <div className="video-off-placeholder">
                                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" alt="User" className="avatar-preview" />
                                <p>Camera is off</p>
                            </div>
                        )}

                        <div className="preview-controls">
                            <button
                                className={`preview-btn ${!micOn ? 'off' : ''}`}
                                onClick={() => setMicOn(!micOn)}
                            >
                                {micOn ? <Mic size={20} /> : <MicOff size={20} />}
                            </button>
                            <button
                                className={`preview-btn ${!videoOn ? 'off' : ''}`}
                                onClick={() => setVideoOn(!videoOn)}
                            >
                                {videoOn ? <Video size={20} /> : <VideoOff size={20} />}
                            </button>
                        </div>

                        <div className="preview-overlay-btn">
                            <Settings size={20} />
                        </div>
                    </div>
                    <div className="preview-status">
                        <p>Check your audio and video before joining</p>
                    </div>
                </div>

                <div className="join-actions-area">
                    <h2>Ready to join?</h2>
                    <p>No one else is here</p>
                    <div className="join-buttons">
                        <button className="join-now-btn" onClick={() => onJoin(localStream, micOn, videoOn)}>Join now</button>
                        <button className="present-btn">
                            <span className="icon">🚀</span> Present
                        </button>
                    </div>
                    <p className="other-options">Other options</p>
                    <div className="join-options">
                        <button className="option-btn" onClick={onBack}>Go back</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GreenRoom;

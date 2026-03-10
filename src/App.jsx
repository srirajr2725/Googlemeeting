import React, { useState, useCallback, useEffect } from 'react';

import LandingPage from './components/LandingPage';
import GreenRoom from './components/GreenRoom';
import MeetingRoom from './components/MeetingRoom';
import './App.css';


function App() {
  const [view, setView] = useState('landing'); // 'landing', 'greenroom', 'meeting'
  const [meetingId, setMeetingId] = useState('');
  const [stream, setStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);

  // Check for meeting ID in URL on load
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const idFromUrl = urlParams.get('room');
    if (idFromUrl) {
      setMeetingId(idFromUrl);
      setView('greenroom');
    }
  }, []);

  const stopTracks = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  }, [stream]);

  const goToGreenRoom = (id) => {
    setMeetingId(id || '9616ec3f-7d0f-4a02-bb35-d8d6a5ca0eae');
    setView('greenroom');
  };

  const joinMeeting = (currentStream, currentMic, currentVideo) => {
    setStream(currentStream);
    setMicOn(currentMic);
    setVideoOn(currentVideo);
    setView('meeting');
  };

  const leaveMeeting = () => {
    stopTracks();
    setView('landing');
    setMeetingId('');
  };

  return (
    <div className="app-container">
      {view === 'landing' && (
        <LandingPage onJoin={goToGreenRoom} />
      )}
      {view === 'greenroom' && (
        <GreenRoom
          onJoin={joinMeeting}
          onBack={() => {
            stopTracks();
            setView('landing');
          }}
        />
      )}
      {view === 'meeting' && (
        <MeetingRoom
          meetingId={meetingId}
          initialStream={stream}
          initialMic={micOn}
          initialVideo={videoOn}
          onLeave={leaveMeeting}
        />
      )}
    </div>
  );
}

export default App;

import React, { useState, useCallback, useEffect } from 'react';
import Login from './components/Login';
import LandingPage from './components/LandingPage';
import GreenRoom from './components/GreenRoom';
import MeetingRoom from './components/MeetingRoom';
import './App.css';

function App() {
  const [view, setView] = useState('login'); 
  const [user, setUser] = useState(null);
  const [meetingId, setMeetingId] = useState('');
  const [stream, setStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);

  const stopTracks = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  }, [stream]);

  const handleLogin = (userData) => {
    setUser(userData);
    setView('landing');
  };

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

  // This is the function that MeetingRoom is looking for
  const leaveMeeting = () => {
    console.log("App.jsx: leaveMeeting called. Changing view to landing.");
    stopTracks();
    setMeetingId('');
    setView('landing'); 
  };

  return (
    <div className="app-container">
      {view === 'login' && <Login onLogin={handleLogin} />}
      
      {view === 'landing' && (
        <LandingPage onJoin={goToGreenRoom} user={user} />
      )}
      
      {view === 'greenroom' && (
        <GreenRoom
          onJoin={joinMeeting}
          onBack={() => setView('landing')}
          user={user}
        />
      )}
      
      {view === 'meeting' && (
        <MeetingRoom
          meetingId={meetingId}
          initialMic={micOn}
          initialVideo={videoOn}
          onLeave={leaveMeeting} // <--- THIS PROP NAME MUST MATCH
          user={user}
        />
      )}
    </div>
  );
}

export default App;
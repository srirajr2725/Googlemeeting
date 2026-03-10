// LandingPage.jsx
import React, { useState } from 'react';
import { Video, Keyboard, Settings, HelpCircle, MessageSquare } from 'lucide-react';
import { motion } from 'framer-motion';
import MeetingRoom from './MeetingRoom';

const LandingPage = ({ user }) => {
  const [meetingCode, setMeetingCode] = useState('');
  const [joinedMeeting, setJoinedMeeting] = useState(null);

  const currentDateTime = new Date().toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const handleNewMeeting = async () => {
    // Generate random UUID for new meeting
    const newMeetingId = crypto.randomUUID();
    await handleJoinMeeting(newMeetingId);
  };

  const handleJoinMeeting = async (idToJoin) => {
    const userId = user?.id || 1;

    try {
      const res = await fetch('https://snappier-reapply-kieth.ngrok-free.dev/participants/join/', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          meeting_id: idToJoin,
          user_id: userId
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`Failed to join participant (${res.status}):`, errText);
      } else {
        console.log(`Joined meeting backend successfully: ${idToJoin}`);
      }
    } catch (e) {
      console.warn('Network error reaching /participants/join/. Proceeding locally.', e);
    }

    setJoinedMeeting(idToJoin);
  };

  if (joinedMeeting) {
    return <MeetingRoom meetingId={joinedMeeting} user={user} />;
  }

  return (
    <div className="landing-container">
      <header className="landing-header">
        <div className="logo-container">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 4.5V14.5C0 15.6046 0.895431 16.5 2 16.5H12V4.5C12 3.39543 11.1046 2.5 10 2.5H2C0.895431 2.5 0 3.39543 0 4.5Z" fill="#00832D"/>
            <path d="M24 11.5L17 16.5V6.5L24 1.5V11.5Z" fill="#00832D"/>
            <path d="M17 14.5V19.5C17 20.6046 16.1046 21.5 15 21.5H2C0.895431 21.5 0 20.6046 0 19.5V16.5H15C16.1046 16.5 17 15.6046 17 14.5Z" fill="#2684FC"/>
            <path d="M17 14.5C17 13.3954 16.1046 12.5 15 12.5H12V16.5H15C16.1046 16.5 17 15.6046 17 14.5Z" fill="#EA4335"/>
            <path d="M12 4.5V16.5H15C16.1046 16.5 17 15.6046 17 14.5V4.5C17 3.39543 16.1046 2.5 15 2.5H12Z" fill="#FFBA00"/>
          </svg>
          <span className="logo-text">Raanuva <span className="bold">Veeran</span></span>
        </div>

        <div className="header-right">
          <div className="date-time">{currentDateTime}</div>
          <div className="header-icons">
            <HelpCircle size={24} />
            <MessageSquare size={24} />
            <Settings size={24} />
          </div>
          <div className="user-avatar">
            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.name || 'User'}`} alt="User" />
          </div>
        </div>
      </header>

      <main className="landing-main">
        <div className="content-left">
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            Video calls and meetings for everyone
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
            Connect, collaborate, and celebrate from anywhere with Raanuva Veeran.
          </motion.p>

          <div className="action-buttons">
            <button className="new-meeting-btn" onClick={handleNewMeeting}>
              <Video size={20}/> New meeting
            </button>

            <div className="join-input-container">
              <div className="input-with-icon">
                <Keyboard size={20} className="input-icon"/>
                <input type="text" placeholder="Enter a code or link" value={meetingCode} onChange={(e) => setMeetingCode(e.target.value)} />
              </div>
              <button className="join-btn" disabled={!meetingCode} onClick={() => handleJoinMeeting(meetingCode)}>
                Join
              </button>
            </div>
          </div>

          <div className="divider" />
          <div className="learn-more">
            <a href="#">Learn more</a> about Raanuva Veeran
          </div>
        </div>

        <div className="content-right">
          <div className="hero-carousel">
            <img src="/hero-meeting.png" alt="Meeting Illustration" className="premium-hero-img" />
            <h3>Premium video meetings</h3>
            <p>Experience high-quality, secure video conferencing with anyone, anywhere, at any time.</p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default LandingPage;
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Mail, Lock, BookOpen } from 'lucide-react';
import './Login.css';

const Login = ({ onLogin }) => {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        role: 'Student'
    });

    const [isLoading, setIsLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
        setErrorMsg('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setErrorMsg('');

        try {
            console.log('Attempting to sign up / log in with:', formData);
            const res = await fetch('https://snappier-reapply-kieth.ngrok-free.dev/users/signup/', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                const data = await res.json();
                console.log('Successfully signed up / logged in!', data);
                // The backend might return the actual user object, merge that with the form data
                onLogin({ ...formData, ...data, id: data.id || data.user_id || 1 });
            } else {
                const errText = await res.text();
                console.warn(`Backend /users/signup/ failed (${res.status}):`, errText);

                // For demonstration, we still let them in locally if the backend isn't perfect yet
                setErrorMsg(`Backend returned ${res.status}. Logging in locally...`);
                setTimeout(() => {
                    onLogin({ ...formData, id: 1 });
                }, 1000);
            }
        } catch (err) {
            console.warn('Network error reaching /users/signup/. Continuing locally.', err);
            // Fallback for frontend flow validation if ngrok is down
            onLogin({ ...formData, id: 1 });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="login-container">
            <motion.div
                className="login-card"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
            >
                <div className="login-header">
                    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M0 4.5V14.5C0 15.6046 0.895431 16.5 2 16.5H12V4.5C12 3.39543 11.1046 2.5 10 2.5H2C0.895431 2.5 0 3.39543 0 4.5Z" fill="#00832D" />
                        <path d="M24 11.5L17 16.5V6.5L24 1.5V11.5Z" fill="#00832D" />
                        <path d="M17 14.5V19.5C17 20.6046 16.1046 21.5 15 21.5H2C0.895431 21.5 0 20.6046 0 19.5V16.5H15C16.1046 16.5 17 15.6046 17 14.5Z" fill="#2684FC" />
                        <path d="M17 14.5C17 13.3954 16.1046 12.5 15 12.5H12V16.5H15C16.1046 16.5 17 15.6046 17 14.5Z" fill="#EA4335" />
                        <path d="M12 4.5V16.5H15C16.1046 16.5 17 15.6046 17 14.5V4.5C17 3.39543 16.1046 2.5 15 2.5H12Z" fill="#FFBA00" />
                    </svg>
                    <h2>Welcome to Google Meet</h2>
                    <p>Log in to join your classes and meetings</p>
                </div>

                <form className="login-form" onSubmit={handleSubmit}>
                    <div className="input-group">
                        <User className="input-icon" size={20} />
                        <input
                            type="text"
                            name="name"
                            placeholder="Full Name"
                            value={formData.name}
                            onChange={handleChange}
                            required
                        />
                    </div>

                    <div className="input-group">
                        <Mail className="input-icon" size={20} />
                        <input
                            type="email"
                            name="email"
                            placeholder="Email Address"
                            value={formData.email}
                            onChange={handleChange}
                            required
                        />
                    </div>

                    <div className="input-group">
                        <Lock className="input-icon" size={20} />
                        <input
                            type="password"
                            name="password"
                            placeholder="Password"
                            value={formData.password}
                            onChange={handleChange}
                            required
                        />
                    </div>

                    <div className="input-group select-group">
                        <BookOpen className="input-icon" size={20} />
                        <select
                            name="role"
                            value={formData.role}
                            onChange={handleChange}
                        >
                            <option value="Student">Student</option>
                            <option value="Teacher">Teacher</option>
                        </select>
                    </div>

                    <button
                        type="submit"
                        className="login-submit-btn"
                        disabled={isLoading}
                    >
                        {isLoading ? 'Connecting...' : 'Continue to Meetings'}
                    </button>
                    {errorMsg && (
                        <div style={{ color: '#ffecb3', marginTop: '12px', fontSize: '14px', textAlign: 'center' }}>
                            {errorMsg}
                        </div>
                    )}
                </form>
            </motion.div>
        </div>
    );
};

export default Login;

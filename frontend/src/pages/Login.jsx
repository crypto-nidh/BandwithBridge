/**
 * Login Page
 */

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Zap, LogIn, Loader2, Info } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const user = await login(email, password);
            navigate(user.role === 'provider' ? '/provider' : '/consumer');
        } catch (err) {
            setError(err.response?.data?.error || 'Login failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-logo">
                    <div className="auth-logo-icon"><Zap size={48} className="text-orange" fill="currentColor" fillOpacity={0.2} /></div>
                    <div className="auth-logo-title gradient-text">Bandwidth Bridge</div>
                    <div className="auth-logo-sub">Decentralized P2P VPN Network</div>
                </div>

                <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24, textAlign: 'center' }}>Welcome Back</h2>

                {error && <div className="alert alert-error">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label className="form-label">Email Address</label>
                        <input
                            type="email"
                            className="form-input"
                            placeholder="you@example.com"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Password</label>
                        <input
                            type="password"
                            className="form-input"
                            placeholder="••••••••"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                        />
                    </div>
                    <button type="submit" className="btn btn-primary btn-full btn-lg flex items-center justify-center gap-2" disabled={loading}>
                        {loading ? <><Loader2 size={18} className="animate-spin" /> Signing In...</> : <><LogIn size={18} /> Sign In</>}
                    </button>
                </form>

                <hr className="divider" />

                <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--text-secondary)' }}>
                    Don't have an account?{' '}
                    <Link to="/register" style={{ color: 'var(--color-cyan)', fontWeight: 600 }}>
                        Create Account
                    </Link>
                </p>

                <div className="alert alert-info mt-4 flex items-start gap-2" style={{ fontSize: 12 }}>
                    <Info size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                    <span><strong>Demo:</strong> Register as a Provider to share bandwidth, or as a Consumer to connect to VPN nodes.</span>
                </div>
            </div>
        </div>
    );
}

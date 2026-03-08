/**
 * Register Page
 */

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
    Zap, UserPlus, Loader2, Gift, 
    Globe, Radio, CheckCircle, Info, Rocket,
    User
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const COUNTRIES = [
    { code: 'US', name: 'United States' }, { code: 'GB', name: 'United Kingdom' },
    { code: 'DE', name: 'Germany' }, { code: 'FR', name: 'France' },
    { code: 'JP', name: 'Japan' }, { code: 'CA', name: 'Canada' },
    { code: 'AU', name: 'Australia' }, { code: 'IN', name: 'India' },
    { code: 'BR', name: 'Brazil' }, { code: 'SG', name: 'Singapore' },
    { code: 'NL', name: 'Netherlands' }, { code: 'SE', name: 'Sweden' },
];

export default function Register() {
    const [form, setForm] = useState({ email: '', password: '', username: '', role: 'consumer', country_code: 'US' });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { register } = useAuth();
    const navigate = useNavigate();

    const handleChange = (e) => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (form.password.length < 8) return setError('Password must be at least 8 characters.');
        setLoading(true);
        try {
            const user = await register(form);
            navigate(user.role === 'provider' ? '/provider' : '/consumer');
        } catch (err) {
            setError(err.response?.data?.error || 'Registration failed.');
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
                    <div className="auth-logo-sub">Join the decentralized VPN network</div>
                </div>

                <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24, textAlign: 'center' }}>Create Account</h2>

                {error && <div className="alert alert-error">{error}</div>}

                <form onSubmit={handleSubmit}>
                    {/* Role selection */}
                    <div className="form-group">
                        <label className="form-label">I want to...</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                            {['consumer', 'provider', 'both'].map(role => (
                                <button
                                    key={role}
                                    type="button"
                                    onClick={() => setForm(prev => ({ ...prev, role }))}
                                    className="btn"
                                    style={{
                                        flexDirection: 'column',
                                        padding: '12px 8px',
                                        background: form.role === role ? 'rgba(99,179,237,0.15)' : 'rgba(255,255,255,0.04)',
                                        border: `1px solid ${form.role === role ? 'var(--color-cyan)' : 'var(--color-border)'}`,
                                        color: form.role === role ? 'var(--color-cyan)' : 'var(--text-secondary)',
                                        fontSize: 11,
                                        fontWeight: 600,
                                        gap: 4
                                    }}
                                >
                                    <span style={{ marginBottom: 4 }}>
                                        {role === 'consumer' ? <User size={20} /> : role === 'provider' ? <Radio size={20} /> : <Zap size={20} />}
                                    </span>
                                    {role.charAt(0).toUpperCase() + role.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Username</label>
                        <input type="text" name="username" className="form-input" placeholder="your_username" value={form.username} onChange={handleChange} required minLength={3} />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Email Address</label>
                        <input type="email" name="email" className="form-input" placeholder="you@example.com" value={form.email} onChange={handleChange} required />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Password</label>
                        <input type="password" name="password" className="form-input" placeholder="Min. 8 characters" value={form.password} onChange={handleChange} required minLength={8} />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Country</label>
                        <select name="country_code" className="form-select" value={form.country_code} onChange={handleChange}>
                            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                        </select>
                    </div>

                    <div className="alert alert-info flex items-center gap-2" style={{ fontSize: 12, marginBottom: 16 }}>
                        <Gift size={16} /> <span>You'll receive <strong>100 credits</strong> as a welcome bonus!</span>
                    </div>

                    <button type="submit" className="btn btn-primary btn-full btn-lg flex items-center justify-center gap-2" disabled={loading}>
                        {loading ? <><Loader2 size={18} className="animate-spin" /> Creating Account...</> : <><Rocket size={18} /> Create Account</>}
                    </button>
                </form>

                <hr className="divider" />
                <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--text-secondary)' }}>
                    Already have an account?{' '}
                    <Link to="/login" style={{ color: 'var(--color-cyan)', fontWeight: 600 }}>Sign In</Link>
                </p>
            </div>
        </div>
    );
}

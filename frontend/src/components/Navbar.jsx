/**
 * Navbar / Sidebar Component
 * 
 * Persistent sidebar navigation with role-aware links,
 * user info, connection status, and logout.
 */

import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
    Globe, Radio, BarChart3, Map, 
    ShoppingCart, LogOut, Zap, User,
    ShieldCheck, Coins
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { disconnectSocket } from '../services/socket';

export default function Navbar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        disconnectSocket();
        logout();
        navigate('/login');
    };

    const isProvider = user?.role === 'provider' || user?.role === 'both';
    const isConsumer = user?.role === 'consumer' || user?.role === 'both';

    return (
        <nav className="sidebar">
            {/* Brand */}
            <div className="nav-brand">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Zap size={28} className="text-orange" fill="currentColor" fillOpacity={0.2} />
                    <div>
                        <div className="nav-brand-title">Bandwidth Bridge</div>
                        <div className="nav-brand-subtitle">P2P VPN Network</div>
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <div className="nav-links">
                {isConsumer && (
                    <>
                        <div className="nav-section-label">Consumer</div>
                        <NavLink to="/consumer" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                            <Globe size={18} className="nav-icon" /> Connect to VPN
                        </NavLink>
                    </>
                )}

                {isProvider && (
                    <>
                        <div className="nav-section-label" style={{ marginTop: '16px' }}>Provider</div>
                        <NavLink to="/provider" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                            <Radio size={18} className="nav-icon" /> Share Bandwidth
                        </NavLink>
                    </>
                )}

                <div className="nav-section-label" style={{ marginTop: '16px' }}>Insights</div>
                <NavLink to="/analytics" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                    <BarChart3 size={18} className="nav-icon" /> Analytics
                </NavLink>
                <NavLink to="/network" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                    <Map size={18} className="nav-icon" /> Network Map
                </NavLink>
                <NavLink to="/marketplace" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                    <ShoppingCart size={18} className="nav-icon" /> Marketplace
                </NavLink>
            </div>

            {/* User info & logout */}
            <div className="nav-footer">
                <div className="card card-sm" style={{ marginBottom: '12px' }}>
                    <div className="flex items-center gap-2">
                        <div style={{
                            width: 36, height: 36, borderRadius: '50%',
                            background: 'var(--gradient-primary)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 800, fontSize: 16, flexShrink: 0
                        }}>
                            {user?.username?.[0]?.toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="truncate" style={{ fontWeight: 600, fontSize: 14 }}>{user?.username}</div>
                            <div className="text-muted text-xs truncate">{user?.role}</div>
                        </div>
                    </div>
                    <div className="flex justify-between mt-2" style={{ fontSize: 12 }}>
                        <span className="text-muted flex items-center gap-1"><ShieldCheck size={12} className="text-orange" /> {parseFloat(user?.trust_score || 5).toFixed(1)}</span>
                        <span className="text-muted flex items-center gap-1"><Coins size={12} className="text-green" /> {user?.credit_balance || 0}</span>
                    </div>
                </div>
                <button className="btn btn-ghost btn-full btn-sm flex items-center justify-center gap-2" onClick={handleLogout}>
                    <LogOut size={14} /> Sign Out
                </button>
            </div>
        </nav>
    );
}

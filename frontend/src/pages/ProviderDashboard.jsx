/**
 * Provider Dashboard
 * 
 * Allows providers to:
 * - Enable/disable bandwidth sharing
 * - Set bandwidth limits and operating hours
 * - View connected users and stats
 * - See real-time bandwidth charts
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import { 
    Radio, Activity, Users, Download, 
    Database, Settings, RefreshCw, CheckCircle, 
    XCircle, Info 
} from 'lucide-react';
import {
    Chart as ChartJS, CategoryScale, LinearScale, PointElement,
    LineElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import Navbar from '../components/Navbar';
import { nodesAPI, sessionsAPI, analyticsAPI } from '../services/api';
import { getSocket } from '../services/socket';
import webrtcService from '../services/webrtc';
import { authAPI } from '../services/api';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const CHART_OPTS = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
    plugins: { 
        legend: { display: false }, 
        tooltip: { 
            backgroundColor: 'rgba(15, 17, 26, 0.8)', 
            titleColor: '#FF7E5F', 
            bodyColor: '#A0AEC0', 
            borderColor: 'rgba(255, 126, 95, 0.3)', 
            borderWidth: 1,
            backdropFilter: 'blur(8px)'
        } 
    },
    scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: 'rgba(255,255,255,0.5)', maxTicksLimit: 8, font: { size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } } }
    }
};

export default function ProviderDashboard() {
    const [node, setNode] = useState(null);
    const [isSharing, setIsSharing] = useState(false);
    const [activeSessions, setActiveSessions] = useState([]);
    const [bandwidthHistory, setBandwidthHistory] = useState([]);
    const [settings, setSettings] = useState({ max_bandwidth_mbps: 10, daily_data_limit_gb: 10, max_connections: 5 });
    const [loading, setLoading] = useState(true);
    const [connectionRequests, setConnectionRequests] = useState([]);
    const [liveMetrics, setLiveMetrics] = useState({ bandwidth: 0, latency: 0, connections: 0 });
    const heartbeatRef = useRef(null);
    const metricsRef = useRef({ bandwidth: 0, latency: 30 });

    const loadData = useCallback(async () => {
        try {
            const [nodeRes, sessRes, analyticsRes] = await Promise.all([
                nodesAPI.getMine(),
                sessionsAPI.getActive(),
                analyticsAPI.getBandwidth(7)
            ]);

            if (nodeRes.data.node) {
                const n = nodeRes.data.node;
                setNode(n);
                setIsSharing(n.is_sharing);
                setSettings({
                    max_bandwidth_mbps: n.max_bandwidth_mbps,
                    daily_data_limit_gb: n.daily_data_limit_gb,
                    max_connections: n.max_connections
                });
            }

            setActiveSessions(sessRes.data.sessions || []);
            setBandwidthHistory(analyticsRes.data.bandwidthHistory || []);
        } catch (err) {
            console.error('Load provider data error:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    // Initialize socket signaling and heartbeat
    useEffect(() => {
        loadData();
        const socket = getSocket();

        // Listen for incoming WebRTC connection requests from consumers
        webrtcService.initSignalingListeners();
        webrtcService.onStatusChange = (status, data) => {
            if (status === 'incoming-request') {
                // AUTO-ACCEPT: immediately accept connection requests
                // (removes need for provider to manually click Accept)
                console.log('Auto-accepting connection from:', data.from?.userId);
                autoAcceptConnection(data);
            }
        };

        // Provider heartbeat: send metrics every 15s
        heartbeatRef.current = setInterval(async () => {
            const bw = 5 + Math.random() * 15; // Simulated, in production measure real speed
            const lat = 20 + Math.random() * 30;
            metricsRef.current = { bandwidth: bw, latency: lat };
            setLiveMetrics(prev => ({ ...prev, bandwidth: bw.toFixed(1), latency: lat.toFixed(0) }));

            try {
                await nodesAPI.heartbeat({ bandwidth_mbps: bw, latency_ms: lat });
            } catch {}
        }, 15000);

        return () => {
            clearInterval(heartbeatRef.current);
        };
    }, [loadData]);

    const toggleSharing = async () => {
        const newState = !isSharing;
        try {
            if (newState) {
                // 1. Connect socket first so we have a socket.id
                const socket = getSocket();

                // 2. Fetch ICE servers for WebRTC
                const iceRes = await authAPI.getIceServers();
                webrtcService.setIceServers(iceRes.data.iceServers);

                // 3. Announce on signaling network (peer_id = socket.id)
                socket.emit('join-network', {
                    peerId: socket.id,  // <-- FIX: this must match what we store in DB
                    isSharing: true,
                    bandwidth: settings.max_bandwidth_mbps
                });

                // 4. Register node in DB with peer_id = socket.id
                //    Also set bandwidth_mbps so discovery filter (>=1 Mbps) passes
                await nodesAPI.register({
                    ...settings,
                    peer_id: socket.id,            // <-- FIX: store socket ID so consumers can target us
                    bandwidth_mbps: settings.max_bandwidth_mbps, // <-- FIX: must be >= 1 for discovery
                    country_code: 'US',
                    country_name: 'United States',
                    city: 'New York'
                });
            } else {
                await nodesAPI.updateStatus({ status: 'offline', is_sharing: false });
            }

            setIsSharing(newState);
            await loadData();
        } catch (err) {
            console.error('Toggle sharing error:', err);
        }
    };

    // Auto-accept an incoming WebRTC connection from a consumer.
    // Uses a ref to access current node value inside the closure.
    const nodeRef = useRef(null);
    useEffect(() => { nodeRef.current = node; }, [node]);

    const autoAcceptConnection = async (request) => {
        const { from } = request;
        try {
            // Get latest node state
            const nodeData = nodeRef.current;
            if (!nodeData?.id) {
                console.warn('Node not registered yet, cannot accept connection');
                return;
            }
            // Create a session record so consumer's sessionsAPI.create succeeds
            // (consumer creates their own session; provider just needs to respond to WebRTC)
            await webrtcService.acceptConnectionRequest(from.socketId, from.sessionId || 'provider-initiated');
            setLiveMetrics(prev => ({ ...prev, connections: (prev.connections || 0) + 1 }));
            // Refresh to show new active session
            setTimeout(loadData, 3000);
        } catch (err) {
            console.error('Auto-accept connection error:', err);
        }
    };

    // Manual accept fallback (for connection requests shown in UI)
    const acceptConnection = async (request) => {
        await autoAcceptConnection(request);
        setConnectionRequests(prev => prev.filter(r => r.from.socketId !== request.from.socketId));
    };

    // Build bandwidth chart
    const chartData = {
        labels: bandwidthHistory.map(d => d.date),
        datasets: [{
            label: 'Bandwidth (Mbps)',
            data: bandwidthHistory.map(d => parseFloat(d.avg_bandwidth || 0)),
            borderColor: '#FF7E5F',
            backgroundColor: 'rgba(255, 126, 95, 0.1)',
            fill: true, tension: 0.4, pointRadius: 3,
            borderWidth: 2
        }]
    };

    if (loading) return (
        <div className="app-layout">
            <Navbar />
            <main className="main-content"><div className="loading-spinner" /></main>
        </div>
    );

    const totalDataShared = parseFloat(node?.total_data_shared_gb || 0).toFixed(2);
    const dailyUsedPercent = node ? ((node.daily_data_used_gb / node.daily_data_limit_gb) * 100).toFixed(0) : 0;

    return (
        <div className="app-layout">
            <Navbar />
            <main className="main-content">
                <div className="page-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                        <Radio size={32} className="text-orange" />
                        <h1 className="page-title" style={{ marginBottom: 0 }}>Provider Dashboard</h1>
                    </div>
                    <p className="page-subtitle">Share your bandwidth and earn credits</p>
                </div>

                {/* Connection activity log (auto-accepted) */}
                {connectionRequests.map((req, i) => (
                    <div key={i} className="alert alert-success" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <span className="flex items-center gap-2">
                             <CheckCircle size={16} /> Auto-accepted connection from <strong>{req.from?.userId || 'consumer'}</strong>
                        </span>
                        <button className="btn btn-ghost btn-sm" onClick={() => setConnectionRequests(p => p.filter((_, j) => j !== i))}>
                             <XCircle size={16} />
                        </button>
                    </div>
                ))}

                {/* Main toggle */}
                <div className={`connection-panel ${isSharing ? 'card-glow-sunset' : ''}`} style={{ marginBottom: 24 }}>
                    <div className="flex justify-between items-center">
                        <div>
                            <h3 style={{ fontSize: 18, fontWeight: 700 }}>Bandwidth Sharing</h3>
                            <p className="text-muted text-sm flex items-center gap-1" style={{ marginTop: 4 }}>
                                {isSharing ? <><CheckCircle size={14} className="text-green" /> You are sharing bandwidth with the network</> : <><Info size={14} /> Sharing is disabled</>}
                            </p>
                        </div>
                        <div className="toggle-wrapper">
                            <label className="toggle">
                                <input type="checkbox" checked={isSharing} onChange={toggleSharing} />
                                <span className="toggle-slider" />
                            </label>
                            <span style={{ fontWeight: 700, fontSize: 14, color: isSharing ? 'var(--color-green)' : 'var(--text-muted)' }}>
                                {isSharing ? 'LIVE' : 'OFF'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid-4" style={{ marginBottom: 24 }}>
                    <div className="stat-card">
                        <div className="stat-label flex items-center gap-2"><Activity size={14} /> Live Bandwidth</div>
                        <div className="stat-value text-orange">{isSharing ? parseFloat(liveMetrics.bandwidth || 0).toFixed(1) : '0.0'}<span className="stat-unit">Mbps</span></div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label flex items-center gap-2"><Users size={14} /> Active Users</div>
                        <div className="stat-value text-purple">{activeSessions.length}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label flex items-center gap-2"><Download size={14} /> Data Shared Today</div>
                        <div className="stat-value text-green">{parseFloat(node?.daily_data_used_gb || 0).toFixed(2)}<span className="stat-unit">GB</span></div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label flex items-center gap-2"><Database size={14} /> Total Data Shared</div>
                        <div className="stat-value text-orange">{totalDataShared}<span className="stat-unit">GB</span></div>
                    </div>
                </div>

                <div className="grid-2" style={{ marginBottom: 24 }}>
                    {/* Bandwidth chart */}
                    <div className="card">
                        <h3 style={{ fontWeight: 700, marginBottom: 16 }}>Bandwidth History (7d)</h3>
                        <div className="chart-container">
                            <Line data={chartData} options={CHART_OPTS} />
                        </div>
                    </div>

                    {/* Settings */}
                    <div className="card">
                        <h3 className="flex items-center gap-2" style={{ fontWeight: 700, marginBottom: 16 }}>
                            <Settings size={20} className="text-orange" /> Sharing Settings
                        </h3>
                        <div className="form-group">
                            <label className="form-label">Max Bandwidth (Mbps)</label>
                            <input type="number" className="form-input" value={settings.max_bandwidth_mbps}
                                onChange={e => setSettings(p => ({ ...p, max_bandwidth_mbps: parseFloat(e.target.value) }))} min="1" max="1000" />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Daily Data Limit (GB)</label>
                            <input type="number" className="form-input" value={settings.daily_data_limit_gb}
                                onChange={e => setSettings(p => ({ ...p, daily_data_limit_gb: parseFloat(e.target.value) }))} min="1" max="1000" />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Max Connections</label>
                            <input type="number" className="form-input" value={settings.max_connections}
                                onChange={e => setSettings(p => ({ ...p, max_connections: parseInt(e.target.value) }))} min="1" max="20" />
                        </div>
                        {/* Daily usage bar */}
                        <div className="mt-4">
                            <div className="flex justify-between text-sm" style={{ marginBottom: 6 }}>
                                <span className="text-muted">Daily Usage</span>
                                <span className="text-cyan">{dailyUsedPercent}%</span>
                            </div>
                            <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 100, height: 8 }}>
                                <div style={{ width: `${Math.min(100, dailyUsedPercent)}%`, height: '100%', background: 'var(--gradient-primary)', borderRadius: 100, transition: 'width 0.5s' }} />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Active sessions table */}
                <div className="card">
                    <h3 className="flex items-center gap-2" style={{ fontWeight: 700, marginBottom: 16 }}>
                        <Users size={20} className="text-purple" /> Active Consumer Sessions
                    </h3>
                    {activeSessions.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon"><Users size={48} /></div>
                            <div className="empty-state-title">No active sessions</div>
                            <div className="empty-state-text">Consumer sessions will appear here when users connect.</div>
                        </div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Consumer</th><th>Duration</th><th>Data</th>
                                    <th>Bandwidth</th><th>Latency</th><th>Credits</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeSessions.map(s => {
                                    const dur = Math.round((Date.now() - new Date(s.started_at)) / 60000);
                                    return (
                                        <tr key={s.id}>
                                            <td><span className="text-cyan">{s.consumer_username}</span></td>
                                            <td className="font-mono">{dur}m</td>
                                            <td>{parseFloat(s.data_transferred_mb || 0).toFixed(1)} MB</td>
                                            <td>{parseFloat(s.avg_bandwidth_mbps || 0).toFixed(1)} Mbps</td>
                                            <td>{s.avg_latency_ms || 0} ms</td>
                                            <td className="text-green">{s.credits_charged || 0}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </main>
        </div>
    );
}

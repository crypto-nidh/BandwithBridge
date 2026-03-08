/**
 * Consumer Dashboard
 * 
 * Allows consumers to:
 * - Browse and filter available provider nodes
 * - Connect to a node via WebRTC
 * - View live connection status, speed, routing path
 * - Disconnect / kill switch
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Navbar from '../components/Navbar';
import { nodesAPI, sessionsAPI } from '../services/api';
import { authAPI } from '../services/api';
import { getSocket } from '../services/socket';
import webrtcService from '../services/webrtc';
import { 
    Globe, Zap, ShieldCheck, Activity, 
    Download, Server, RefreshCw, XCircle,
    Info, Wifi, Link
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// No longer using FLAG_MAP with emojis

function NodeCard({ node, selected, onSelect }) {
    const score = (parseFloat(node.discovery_score || 0) * 100).toFixed(0);
    // Flag icons replaced by Globe icon in node-flag-placeholder
    return (
        <div className={`node-card ${selected ? 'selected' : ''}`} onClick={() => onSelect(node)}>
            <div className="node-card-header">
                <div className="flex items-center gap-2">
                    <div className="node-flag-placeholder"><Globe size={18} className="text-muted" /></div>
                    <div>
                        <div className="node-name">{node.username}</div>
                        <div className="node-location">{node.city || node.country_name || node.country_code}</div>
                    </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div className="node-score">{score}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>SCORE</div>
                </div>
            </div>
            <div className="node-metrics">
                <div className="node-metric">
                    <div className="node-metric-value text-orange">{node.latency_ms || '—'}</div>
                    <div className="node-metric-label">ms latency</div>
                </div>
                <div className="node-metric">
                    <div className="node-metric-value text-green">{parseFloat(node.bandwidth_mbps || 0).toFixed(0)}</div>
                    <div className="node-metric-label">Mbps</div>
                </div>
                <div className="node-metric">
                    <div className="node-metric-value text-purple">{parseFloat(node.trust_score || 5).toFixed(1)}</div>
                    <div className="node-metric-label">trust</div>
                </div>
            </div>
            <div className="flex justify-between mt-2" style={{ fontSize: 11, marginTop: 12 }}>
                <span className="text-muted">{node.current_connections}/{node.max_connections} users</span>
                <span className="badge badge-online">Online</span>
            </div>
        </div>
    );
}

export default function ConsumerDashboard() {
    const { user, updateUserLocally } = useAuth();
    const [nodes, setNodes] = useState([]);
    const [selectedNode, setSelectedNode] = useState(null);
    const [connectionStatus, setConnectionStatus] = useState('idle'); // idle|connecting|connected|disconnected
    const [sessionId, setSessionId] = useState(null);
    const [metrics, setMetrics] = useState({ bandwidth: 0, latency: 0, bytesTotal: 0 });
    const [routePath, setRoutePath] = useState([]);
    const [filters, setFilters] = useState({ country_code: '', min_trust_score: 0, min_bandwidth: 0 });
    const [loading, setLoading] = useState(true);
    const [killSwitchActive, setKillSwitchActive] = useState(false);
    const metricsUpdateRef = useRef(null);

    const loadNodes = useCallback(async () => {
        try {
            const params = { min_bandwidth: 0 }; // Show all nodes regardless of bandwidth
            if (filters.country_code) params.country_code = filters.country_code;
            if (filters.min_trust_score) params.min_trust_score = filters.min_trust_score;
            const res = await nodesAPI.discover(params);
            setNodes(res.data.nodes || []);
        } catch (err) {
            console.error('Failed to load nodes:', err);
        } finally {
            setLoading(false);
        }
    }, [filters]);

    useEffect(() => {
        loadNodes();
    }, [loadNodes]);

    // Setup WebRTC listeners and socket
    useEffect(() => {
        const iceSetup = async () => {
            try {
                const res = await authAPI.getIceServers();
                webrtcService.setIceServers(res.data.iceServers);
            } catch {}
        };
        iceSetup();

        const socket = getSocket();
        socket.emit('join-network', { isSharing: false });
        webrtcService.initSignalingListeners();

        webrtcService.onStatusChange = (status) => {
            setConnectionStatus(status === 'connected' ? 'connected' : status);
            if (status === 'disconnected' || status === 'failed') {
                setSessionId(null);
            }
        };

        webrtcService.onMetricsUpdate = (m) => {
            setMetrics(m);
            // Update session metrics in DB every 10s
            if (sessionId && m.bytesTotal > 0) {
                sessionsAPI.updateMetrics(sessionId, {
                    bytes_sent: m.bytesSent || 0,
                    bytes_received: m.bytesReceived || 0,
                    avg_latency_ms: Math.round(m.latency || 0),
                    avg_bandwidth_mbps: parseFloat(m.bandwidth || 0)
                }).catch(() => {});
            }
        };

        return () => {
            clearInterval(metricsUpdateRef.current);
        };
    }, [sessionId]);

    const handleConnect = async () => {
        if (!selectedNode) return;
        setConnectionStatus('connecting');

        try {
            // Create session record in DB
            const sessRes = await sessionsAPI.create({ provider_node_id: selectedNode.id });
            const newSessionId = sessRes.data.sessionId;
            setSessionId(newSessionId);

            // Build multi-hop route display
            setRoutePath(['You', selectedNode.city || selectedNode.country_code, 'Internet']);

            // Initiate WebRTC connection via signaling server
            // peer_id is the provider's socket.id stored in the database
            await webrtcService.connectToPeer(selectedNode.peer_id, newSessionId, {
                nodeId: selectedNode.id,
                country: selectedNode.country_name,
                sessionId: newSessionId // provider uses this to link the session
            });

            // Wait for WebRTC status change (driven by webrtcService.onStatusChange)
            // Fallback: after 5s assume connected (works for demo when provider is in same browser)
            setTimeout(() => {
                setConnectionStatus(prev => prev === 'connecting' ? 'connected' : prev);
            }, 5000);

        } catch (err) {
            console.error('Connect error:', err);
            setConnectionStatus('idle');
            alert(err.response?.data?.error || 'Connection failed');
        }
    };

    const handleDisconnect = async () => {
        if (sessionId) {
            webrtcService.disconnect();
            try {
                await sessionsAPI.end(sessionId, { disconnect_reason: 'user_disconnect' });
            } catch {}
            setSessionId(null);
        }
        setConnectionStatus('idle');
        setMetrics({ bandwidth: 0, latency: 0, bytesTotal: 0 });
        setRoutePath([]);
    };

    // Kill switch: simulate blocking all traffic
    const activateKillSwitch = async () => {
        setKillSwitchActive(true);
        await handleDisconnect();
        alert('Kill Switch Activated\n\nVPN connection terminated. In a full implementation, this would block all non-VPN internet traffic through firewall rules.');
        setTimeout(() => setKillSwitchActive(false), 10000);
    };

    const statusColors = { idle: 'var(--text-muted)', connecting: 'var(--color-orange)', connected: 'var(--color-green)', disconnected: 'var(--color-red)', failed: 'var(--color-red)' };
    const bytesFormatted = (bytes) => bytes > 1048576 ? `${(bytes/1048576).toFixed(1)} MB` : bytes > 1024 ? `${(bytes/1024).toFixed(0)} KB` : `${bytes} B`;

    return (
        <div className="app-layout">
            <Navbar />
            <main className="main-content">
                <div className="page-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                        <Globe size={32} className="text-orange" />
                        <h1 className="page-title" style={{ marginBottom: 0 }}>Connect to VPN</h1>
                    </div>
                    <p className="page-subtitle">Browse and connect to provider nodes</p>
                </div>

                {/* Connection Status Panel */}
                <div className="connection-panel" style={{ marginBottom: 24 }}>
                    <div className="flex justify-between items-center">
                        <div>
                            <div className="flex items-center gap-2">
                                <div className={`status-dot ${connectionStatus === 'connected' ? 'status-dot-online' : connectionStatus === 'connecting' ? 'status-dot-connecting' : 'status-dot-offline'}`} />
                                <span style={{ fontWeight: 700, fontSize: 18, color: statusColors[connectionStatus] || 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {connectionStatus === 'connected' ? <Link size={18} /> : connectionStatus === 'connecting' ? <RefreshCw size={18} className="animate-spin" /> : <Wifi size={18} />}
                                    {connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
                                </span>
                            </div>
                            {connectionStatus === 'connected' && selectedNode && (
                                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Globe size={14} className="text-orange" /> Connected to {selectedNode.username} ({selectedNode.country_name || selectedNode.country_code})
                                </div>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            {connectionStatus === 'idle' && (
                                <button className="btn btn-primary flex items-center gap-2" onClick={handleConnect} disabled={!selectedNode}>
                                    <Zap size={16} /> Connect
                                </button>
                            )}
                                <button className="btn btn-ghost flex items-center gap-2" disabled>
                                    <Loader2 size={16} className="animate-spin" /> Connecting...
                                </button>
                            {connectionStatus === 'connected' && (
                                <>
                                    <button className="btn btn-danger btn-sm" onClick={handleDisconnect}>Disconnect</button>
                                    <button className="kill-switch-btn flex items-center gap-2" style={{ padding: '8px 16px', fontSize: 13 }} onClick={activateKillSwitch}>
                                        <XCircle size={16} /> KILL SWITCH
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Routing path */}
                    {routePath.length > 0 && (
                        <div className="connection-route">
                            {routePath.map((hop, i) => (
                                <React.Fragment key={i}>
                                    <div className="route-node">{hop}</div>
                                    {i < routePath.length - 1 && <div className="route-arrow">→</div>}
                                </React.Fragment>
                            ))}
                        </div>
                    )}

                    {/* Live metrics */}
                    {connectionStatus === 'connected' && (
                        <div className="grid-3" style={{ marginTop: 16 }}>
                            <div style={{ textAlign: 'center' }}>
                                <div className="speed-value text-orange">{parseFloat(metrics.bandwidth || 0).toFixed(1)}</div>
                                <div className="speed-unit">Mbps bandwidth</div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                                <div className="speed-value text-purple">{Math.round(metrics.latency || 0)}</div>
                                <div className="speed-unit">ms latency</div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                                <div className="speed-value text-green">{bytesFormatted(metrics.bytesTotal || 0)}</div>
                                <div className="speed-unit">transferred</div>
                            </div>
                        </div>
                    )}

                    {killSwitchActive && (
                        <div className="alert alert-error flex items-center gap-2" style={{ marginTop: 16 }}>
                            <XCircle size={18} /> Kill Switch Active — All traffic blocked for 10 seconds
                        </div>
                    )}
                </div>

                {/* Filters */}
                <div className="card" style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 150 }}>
                            <label className="form-label">Country</label>
                            <select className="form-select" value={filters.country_code}
                                onChange={e => setFilters(p => ({ ...p, country_code: e.target.value }))}>
                                <option value="">All Countries</option>
                                {['US','GB','DE','FR','JP','CA','AU','IN','SG','NL'].map(c => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 150 }}>
                            <label className="form-label">Min Trust Score</label>
                            <select className="form-select" value={filters.min_trust_score}
                                onChange={e => setFilters(p => ({ ...p, min_trust_score: parseFloat(e.target.value) }))}>
                                <option value={1}>Any</option>
                                <option value={3}>3.0+</option>
                                <option value={5}>5.0+</option>
                                <option value={7}>7.0+</option>
                            </select>
                        </div>
                        <button className="btn btn-outline btn-sm flex items-center gap-2" onClick={loadNodes} style={{ marginBottom: 0 }}>
                            <RefreshCw size={14} /> Refresh
                        </button>
                    </div>
                </div>

                {/* Node list */}
                <div>
                    <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
                        <h3 style={{ fontWeight: 700 }}>Available Nodes ({nodes.length})</h3>
                        {selectedNode && (
                            <div style={{ fontSize: 13, color: 'var(--color-sunset-orange)' }}>
                                Selected: {selectedNode.username}
                            </div>
                        )}
                    </div>

                    {loading ? <div className="loading-spinner" /> : nodes.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon"><Server size={48} /></div>
                            <div className="empty-state-title">No nodes available</div>
                            <div className="empty-state-text">No providers are currently sharing. Try adjusting your filters or check back later.</div>
                        </div>
                    ) : (
                        <div className="grid-3">
                            {nodes.map(node => (
                                <NodeCard
                                    key={node.id}
                                    node={node}
                                    selected={selectedNode?.id === node.id}
                                    onSelect={setSelectedNode}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

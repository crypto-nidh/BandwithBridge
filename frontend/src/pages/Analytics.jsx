/**
 * Analytics Page
 * 
 * Shows real-time and historical analytics with Chart.js charts:
 * - Bandwidth usage over time (line chart)
 * - Session count per day (bar chart)
 * - Network overview stats
 */

import React, { useState, useEffect } from 'react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
    Chart as ChartJS, CategoryScale, LinearScale, PointElement,
    LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { 
    BarChart3, Users, Globe, Database, 
    Activity, ShieldCheck, Coins, Timer,
    LayoutDashboard
} from 'lucide-react';
import Navbar from '../components/Navbar';
import { analyticsAPI, nodesAPI } from '../services/api';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler);

const CHART_OPTS_BASE = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
    plugins: {
        legend: { labels: { color: 'rgba(255, 255, 255, 0.7)', font: { size: 12, weight: '500' } } },
        tooltip: { 
            backgroundColor: 'rgba(15, 17, 26, 0.85)', 
            titleColor: '#FF7E5F', 
            bodyColor: 'rgba(255, 255, 255, 0.8)', 
            borderColor: 'rgba(255, 126, 95, 0.3)', 
            borderWidth: 1,
            backdropFilter: 'blur(10px)',
            padding: 12
        }
    },
    scales: {
        x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 11 }, maxTicksLimit: 10 } },
        y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 11 } } }
    }
};

export default function Analytics() {
    const [overview, setOverview] = useState(null);
    const [bandwidth, setBandwidth] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [networkStats, setNetworkStats] = useState(null);
    const [days, setDays] = useState(7);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                const [ov, bw, sess, net] = await Promise.all([
                    analyticsAPI.getOverview(),
                    analyticsAPI.getBandwidth(days),
                    analyticsAPI.getSessions(days),
                    nodesAPI.getStats()
                ]);
                setOverview(ov.data);
                setBandwidth(bw.data.bandwidthHistory || []);
                setSessions(sess.data.sessionHistory || []);
                setNetworkStats(net.data);
            } catch (err) {
                console.error('Analytics load error:', err);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [days]);

    const bwChartData = {
        labels: bandwidth.map(d => d.date),
        datasets: [{
            label: 'Avg Bandwidth (Mbps)',
            data: bandwidth.map(d => parseFloat(d.avg_bandwidth || 0)),
            borderColor: '#FF7E5F', backgroundColor: 'rgba(255, 126, 95, 0.1)',
            fill: true, tension: 0.4, pointRadius: 3, borderWidth: 2
        }, {
            label: 'Avg Latency (ms)',
            data: bandwidth.map(d => parseFloat(d.avg_latency || 0)),
            borderColor: '#6B52D1', backgroundColor: 'rgba(107, 82, 209, 0.05)',
            fill: true, tension: 0.4, pointRadius: 3, borderWidth: 2
        }]
    };

    const sessionChartData = {
        labels: sessions.map(d => d.date),
        datasets: [{
            label: 'Sessions',
            data: sessions.map(d => parseInt(d.session_count || 0)),
            backgroundColor: 'rgba(255, 77, 109, 0.6)',
            borderColor: '#FF4D6D', borderWidth: 1, borderRadius: 6
        }, {
            label: 'Data (MB)',
            data: sessions.map(d => parseFloat(d.total_data_mb || 0)),
            backgroundColor: 'rgba(0, 255, 135, 0.5)',
            borderColor: '#00FF87', borderWidth: 1, borderRadius: 6,
            yAxisID: 'y1'
        }]
    };

    const sessionChartOpts = {
        ...CHART_OPTS_BASE,
        scales: {
            ...CHART_OPTS_BASE.scales,
            y: { ...CHART_OPTS_BASE.scales.y, position: 'left' },
            y1: { position: 'right', grid: { display: false }, ticks: { color: '#718096', font: { size: 11 } } }
        }
    };

    const us = overview?.userStats;
    const cs = overview?.consumerStats;
    const net = networkStats?.network;

    if (loading) return (
        <div className="app-layout">
            <Navbar />
            <main className="main-content"><div className="loading-spinner" /></main>
        </div>
    );

    return (
        <div className="app-layout">
            <Navbar />
            <main className="main-content">
                <div className="flex justify-between items-center" style={{ marginBottom: 32 }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                            <BarChart3 size={32} className="text-orange" />
                            <h1 className="page-title" style={{ marginBottom: 0 }}>Analytics</h1>
                        </div>
                        <p className="page-subtitle">Network performance and personal statistics</p>
                    </div>
                    <select className="form-select" style={{ width: 'auto' }} value={days} onChange={e => setDays(parseInt(e.target.value))}>
                        <option value={7}>Last 7 days</option>
                        <option value={14}>Last 14 days</option>
                        <option value={30}>Last 30 days</option>
                    </select>
                </div>

                {/* Network-wide stats */}
                <div className="grid-4" style={{ marginBottom: 24 }}>
                    <div className="stat-card card-glow-sunset">
                        <div className="stat-label flex items-center gap-2"><Globe size={14} /> Online Nodes</div>
                        <div className="stat-value text-orange">{net?.online_nodes || 0}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label flex items-center gap-2"><Activity size={14} /> Total Bandwidth</div>
                        <div className="stat-value text-green">{parseFloat(net?.total_bandwidth || 0).toFixed(0)}<span className="stat-unit">Mbps</span></div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label flex items-center gap-2"><Timer size={14} /> Avg Latency</div>
                        <div className="stat-value text-purple">{Math.round(net?.avg_latency || 0)}<span className="stat-unit">ms</span></div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label flex items-center gap-2"><Globe size={14} /> Countries</div>
                        <div className="stat-value text-orange">{net?.countries_count || 0}</div>
                    </div>
                </div>

                {/* Personal stats */}
                <div className="grid-4" style={{ marginBottom: 24 }}>
                    <div className="stat-card">
                        <div className="stat-label flex items-center gap-2"><Coins size={14} /> Credit Balance</div>
                        <div className="stat-value text-green">{us?.credit_balance || 0}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label flex items-center gap-2"><ShieldCheck size={14} /> Trust Score</div>
                        <div className="stat-value text-orange">{parseFloat(us?.trust_score || 5).toFixed(1)}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label flex items-center gap-2"><Database size={14} /> Data Shared</div>
                        <div className="stat-value text-purple">{parseFloat(us?.total_data_shared_gb || 0).toFixed(2)}<span className="stat-unit">GB</span></div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label flex items-center gap-2"><LayoutDashboard size={14} /> Sessions Total</div>
                        <div className="stat-value text-orange">{parseInt(cs?.total_sessions || 0) + parseInt(us?.total_provider_sessions || 0)}</div>
                    </div>
                </div>

                {/* Charts */}
                <div className="grid-2" style={{ marginBottom: 24 }}>
                    <div className="card">
                        <h3 style={{ fontWeight: 700, marginBottom: 16 }}>Bandwidth & Latency</h3>
                        <div className="chart-container">
                            <Line data={bwChartData} options={CHART_OPTS_BASE} />
                        </div>
                    </div>
                    <div className="card">
                        <h3 style={{ fontWeight: 700, marginBottom: 16 }}>Sessions & Data Transfer</h3>
                        <div className="chart-container">
                            <Bar data={sessionChartData} options={sessionChartOpts} />
                        </div>
                    </div>
                </div>

                {/* Recent sessions */}
                <div className="card">
                    <h3 style={{ fontWeight: 700, marginBottom: 16 }}>Recent Sessions</h3>
                    {!overview?.recentSessions?.length ? (
                        <div className="empty-state">
                            <div className="empty-state-icon"><Database size={48} /></div>
                            <div className="empty-state-title">No sessions yet</div>
                            <div className="empty-state-text">Connect to a node or enable sharing to see session data here.</div>
                        </div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr><th>Role</th><th>Peer</th><th>Date</th><th>Data</th><th>Bandwidth</th><th>Credits</th><th>Status</th></tr>
                            </thead>
                            <tbody>
                                {overview.recentSessions.map(s => (
                                    <tr key={s.id}>
                                        <td><span className="badge" style={{ background: s.role === 'provider' ? 'rgba(99,179,237,0.15)' : 'rgba(183,148,244,0.15)', color: s.role === 'provider' ? 'var(--color-cyan)' : 'var(--color-purple)' }}>{s.role}</span></td>
                                        <td>{s.peer_username}</td>
                                        <td className="text-muted font-mono" style={{ fontSize: 12 }}>{new Date(s.started_at).toLocaleDateString()}</td>
                                        <td>{parseFloat(s.data_transferred_mb || 0).toFixed(1)} MB</td>
                                        <td>{parseFloat(s.avg_bandwidth_mbps || 0).toFixed(1)} Mbps</td>
                                        <td className={s.role === 'provider' ? 'text-green' : 'text-orange'}>{s.role === 'provider' ? '+' : '-'}{s.credits_charged || 0}</td>
                                        <td><span className={`badge badge-${s.status === 'active' ? 'online' : s.status === 'disconnected' ? 'offline' : 'connecting'}`}>{s.status}</span></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </main>
        </div>
    );
}

/**
 * Marketplace Page
 * 
 * Shows credit balance, transactions, top providers, and marketplace stats.
 */

import React, { useState, useEffect } from 'react';
import { 
    ShoppingCart, Zap, Coins, ArrowUpRight, 
    ArrowDownLeft, Gift, ShieldCheck, Info, 
    Trophy, Star, RefreshCcw, AlertTriangle,
    CreditCard, TrendingUp, TrendingDown
} from 'lucide-react';
import Navbar from '../components/Navbar';
import { creditsAPI } from '../services/api';

export default function Marketplace() {
    const [balanceData, setBalanceData] = useState(null);
    const [marketData, setMarketData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            try {
                const [bal, mkt] = await Promise.all([creditsAPI.getBalance(), creditsAPI.getMarketplace()]);
                setBalanceData(bal.data);
                setMarketData(mkt.data);
            } catch (err) {
                console.error('Marketplace load error:', err);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    if (loading) return <div className="app-layout"><Navbar /><main className="main-content"><div className="loading-spinner" /></main></div>;

    const txTypeColor = { earn: 'var(--color-green)', spend: 'var(--color-orange)', bonus: 'var(--color-sunset-pink)', initial: 'var(--color-sunset-purple)', refund: 'var(--color-sunset-orange)' };
    const txTypeIcon = { 
        earn: <TrendingUp size={16} />, 
        spend: <TrendingDown size={16} />, 
        bonus: <Gift size={16} />, 
        initial: <Star size={16} />, 
        refund: <RefreshCcw size={16} />, 
        penalty: <AlertTriangle size={16} /> 
    };

    return (
        <div className="app-layout">
            <Navbar />
            <main className="main-content">
                <div className="page-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                        <ShoppingCart size={32} className="text-orange" />
                        <h1 className="page-title" style={{ marginBottom: 0 }}>Bandwidth Marketplace</h1>
                    </div>
                    <p className="page-subtitle">Earn credits by sharing bandwidth, spend to access the network</p>
                </div>

                {/* Credit info banner */}
                <div className="alert alert-info flex items-center gap-2" style={{ marginBottom: 24 }}>
                    <Zap size={18} /> <strong>Credit Rate:</strong> 0.1 credits per MB transferred &nbsp;|&nbsp;
                    Providers <span className="text-green">earn</span> credits &nbsp;|&nbsp;
                    Consumers <span className="text-orange">spend</span> credits
                </div>

                {/* Balance stats */}
                <div className="grid-4" style={{ marginBottom: 24 }}>
                    <div className="stat-card card-glow-sunset">
                        <div className="stat-label flex items-center gap-2"><Coins size={14} /> Your Balance</div>
                        <div className="stat-value text-orange">{balanceData?.balance || 0}<span className="stat-unit">credits</span></div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label flex items-center gap-2"><TrendingUp size={14} /> Total Earned</div>
                        <div className="stat-value text-green">{balanceData?.stats?.total_earned || 0}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label flex items-center gap-2"><TrendingDown size={14} /> Total Spent</div>
                        <div className="stat-value text-orange">{balanceData?.stats?.total_spent || 0}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label flex items-center gap-2"><RefreshCcw size={14} /> In Circulation</div>
                        <div className="stat-value text-purple">{parseInt(marketData?.marketStats?.total_credits_in_circulation || 0).toLocaleString()}</div>
                    </div>
                </div>

                <div className="grid-2">
                    {/* Transaction history */}
                    <div className="card">
                        <h3 className="flex items-center gap-2" style={{ fontWeight: 700, marginBottom: 16 }}>
                            <CreditCard size={20} className="text-orange" /> Transaction History
                        </h3>
                        {!balanceData?.transactions?.length ? (
                            <div className="empty-state">
                                <div className="empty-state-icon"><CreditCard size={48} /></div>
                                <div className="empty-state-text">No transactions yet.</div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {balanceData.transactions.map(tx => (
                                    <div key={tx.id || tx.created_at} className="card card-sm" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', color: txTypeColor[tx.type] }}>
                                                {txTypeIcon[tx.type] || <CreditCard size={16} />}
                                            </div>
                                            <div>
                                                <div style={{ fontSize: 13, fontWeight: 600 }}>{tx.description || tx.type}</div>
                                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(tx.created_at).toLocaleString()}</div>
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontWeight: 700, fontSize: 15, color: txTypeColor[tx.type] || 'var(--text-primary)' }}>
                                                {tx.amount > 0 ? '+' : ''}{tx.amount}
                                            </div>
                                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>bal: {tx.balance_after}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Top providers leaderboard */}
                    <div className="card">
                        <h3 className="flex items-center gap-2" style={{ fontWeight: 700, marginBottom: 16 }}>
                            <Trophy size={20} className="text-purple" /> Top Providers
                        </h3>
                        {!marketData?.topProviders?.length ? (
                            <div className="empty-state">
                                <div className="empty-state-icon"><Trophy size={48} /></div>
                                <div className="empty-state-text">No providers yet.</div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {marketData.topProviders.map((p, i) => (
                                    <div key={p.username} className="card card-sm" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div className="flex items-center gap-2">
                                            <div style={{ width: 28, height: 28, borderRadius: '50%', background: i === 0 ? 'var(--color-sunset-orange)' : i === 1 ? 'var(--color-sunset-pink)' : i === 2 ? 'var(--color-sunset-purple)' : 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12 }}>
                                                {i + 1}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: 14 }}>{p.username}</div>
                                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Trust: {parseFloat(p.trust_score || 5).toFixed(1)} | {parseInt(p.total_sessions || 0)} sessions</div>
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontWeight: 700, color: 'var(--color-green)', fontSize: 14 }}>{p.credit_balance} cr</div>
                                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{parseFloat(p.total_data_shared_gb || 0).toFixed(1)} GB shared</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="card card-sm" style={{ marginTop: 12, background: 'rgba(255,126,95,0.03)', borderColor: 'rgba(255,126,95,0.1)' }}>
                            <div className="flex items-center gap-2" style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                                <Info size={16} className="text-orange" /> How to Earn Credits
                            </div>
                            <ul style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <li>Enable bandwidth sharing in the Provider Dashboard</li>
                                <li>Earn 0.1 credits per MB of traffic served</li>
                                <li>Maintain high trust score for better matching</li>
                                <li>High uptime = more connections = more credits</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

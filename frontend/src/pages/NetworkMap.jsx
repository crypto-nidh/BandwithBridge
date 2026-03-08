/**
 * Network Map Page
 * 
 * D3.js force-directed graph showing the live P2P mesh network.
 * Nodes = peers, Edges = active connections
 * 
 * Node color indicates role:
 *   - Provider: cyan/blue
 *   - Consumer: purple
 * Node size indicates trust score.
 */

import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { 
    Map, Terminal, MousePointer2, Search, 
    Activity, Link2, Database, Globe, Info
} from 'lucide-react';
import Navbar from '../components/Navbar';
import { nodesAPI } from '../services/api';

export default function NetworkMap() {
    const svgRef = useRef(null);
    const [topology, setTopology] = useState({ nodes: [], edges: [] });
    const [networkStats, setNetworkStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selectedNode, setSelectedNode] = useState(null);

    useEffect(() => {
        const load = async () => {
            try {
                const [topoRes, statsRes] = await Promise.all([
                    nodesAPI.getTopology(),
                    nodesAPI.getStats()
                ]);
                setTopology(topoRes.data);
                setNetworkStats(statsRes.data);
            } catch (err) {
                console.error('Topology load error:', err);
            } finally {
                setLoading(false);
            }
        };
        load();
        const interval = setInterval(load, 30000); // Refresh every 30s
        return () => clearInterval(interval);
    }, []);

    // Build D3 simulation whenever topology changes
    useEffect(() => {
        if (!svgRef.current || loading) return;

        const container = svgRef.current.parentElement;
        const W = container.clientWidth;
        const H = container.clientHeight;

        // Clear previous render
        d3.select(svgRef.current).selectAll('*').remove();

        const svg = d3.select(svgRef.current)
            .attr('width', W)
            .attr('height', H);

        // Add subtle grid pattern background
        const defs = svg.append('defs');
        const pattern = defs.append('pattern').attr('id', 'grid').attr('width', 40).attr('height', 40).attr('patternUnits', 'userSpaceOnUse');
        pattern.append('path').attr('d', 'M 40 0 L 0 0 0 40').attr('fill', 'none').attr('stroke', 'rgba(255,255,255,0.03)').attr('stroke-width', '0.5');
        svg.append('rect').attr('width', W).attr('height', H).attr('fill', 'url(#grid)');

        // Add glow filter
        const glowFilter = defs.append('filter').attr('id', 'glow');
        glowFilter.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'coloredBlur');
        const feMerge = glowFilter.append('feMerge');
        feMerge.append('feMergeNode').attr('in', 'coloredBlur');
        feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

        const orangeGlow = defs.append('filter').attr('id', 'orange-glow');
        orangeGlow.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur');
        const feMergeOrange = orangeGlow.append('feMerge');
        feMergeOrange.append('feMergeNode').attr('in', 'blur');
        feMergeOrange.append('feMergeNode').attr('in', 'SourceGraphic');

        // If no real nodes from API, generate demo nodes
        let nodes = topology.nodes.length > 0 ? topology.nodes : generateDemoNodes();
        let links = topology.edges.length > 0 ? topology.edges.filter(e =>
            nodes.find(n => n.id === e.source) && nodes.find(n => n.id === e.target)
        ) : generateDemoLinks(nodes);

        // D3 Force Simulation
        const simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).id(d => d.id).distance(100).strength(0.5))
            .force('charge', d3.forceManyBody().strength(-200))
            .force('center', d3.forceCenter(W / 2, H / 2))
            .force('collision', d3.forceCollide(40));

        // Zoom support
        const zoomGroup = svg.append('g');
        svg.call(d3.zoom().scaleExtent([0.3, 3]).on('zoom', (e) => {
            zoomGroup.attr('transform', e.transform);
        }));

        // Draw connection edges
        const link = zoomGroup.append('g').selectAll('line').data(links).enter().append('line')
            .attr('stroke', 'rgba(107, 82, 209, 0.4)')
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '4 2');

        // Animated edge particles
        const edgeParticles = zoomGroup.append('g').selectAll('circle').data(links).enter().append('circle')
            .attr('r', 2.5)
            .attr('fill', '#FF4D6D')
            .attr('opacity', 0.9)
            .attr('filter', 'url(#glow)');

        // Draw nodes
        const nodeGroup = zoomGroup.append('g').selectAll('g').data(nodes).enter().append('g')
            .attr('cursor', 'pointer')
            .call(d3.drag()
                .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
                .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
                .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
            )
            .on('click', (e, d) => setSelectedNode(d));

        // Node outer glow ring
        nodeGroup.append('circle')
            .attr('r', d => 16 + (parseFloat(d.trust_score || 5) / 10) * 6)
            .attr('fill', 'none')
            .attr('stroke', d => d.status === 'online' ? 'rgba(255, 126, 95, 0.25)' : 'rgba(113, 128, 150, 0.15)')
            .attr('stroke-width', 12)
            .attr('filter', 'url(#glow)');

        // Node core circle
        nodeGroup.append('circle')
            .attr('r', d => 12 + (parseFloat(d.trust_score || 5) / 10) * 4)
            .attr('fill', d => d.status === 'online' ? 'rgba(255, 126, 95, 0.2)' : 'rgba(45, 55, 72, 0.8)')
            .attr('stroke', d => d.status === 'online' ? '#FF7E5F' : '#4A5568')
            .attr('stroke-width', 2);

        // Country flag emoji
        nodeGroup.append('text')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('font-size', '14px')
            .text(d => d.country_code || '??');

        // Username label
        nodeGroup.append('text')
            .attr('y', d => 20 + (parseFloat(d.trust_score || 5) / 10) * 4)
            .attr('text-anchor', 'middle')
            .attr('fill', '#A0AEC0')
            .attr('font-size', '11px')
            .attr('font-family', 'Inter, sans-serif')
            .text(d => d.username || 'Node');

        // Bandwidth label
        nodeGroup.append('text')
            .attr('y', d => 33 + (parseFloat(d.trust_score || 5) / 10) * 4)
            .attr('text-anchor', 'middle')
            .attr('fill', '#FFB347')
            .attr('font-size', '10px')
            .attr('font-family', 'JetBrains Mono, monospace')
            .text(d => d.status === 'online' ? `${parseFloat(d.bandwidth_mbps || 0).toFixed(0)} Mbps` : 'offline');

        let frameCount = 0;
        simulation.on('tick', () => {
            link
                .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x).attr('y2', d => d.target.y);

            nodeGroup.attr('transform', d => `translate(${d.x || 0},${d.y || 0})`);

            // Animate particles along edges every few ticks
            frameCount++;
            if (links.length > 0) {
                edgeParticles.attr('cx', d => {
                    const t = (frameCount * 0.02) % 1;
                    return (d.source.x || 0) + ((d.target.x || 0) - (d.source.x || 0)) * t;
                }).attr('cy', d => {
                    const t = (frameCount * 0.02) % 1;
                    return (d.source.y || 0) + ((d.target.y || 0) - (d.source.y || 0)) * t;
                });
            }
        });

        return () => simulation.stop();
    }, [topology, loading]);

    function generateDemoNodes() {
        const countries = ['US', 'GB', 'DE', 'JP', 'CA', 'AU', 'SG', 'FR', 'IN', 'NL'];
        return countries.map((code, i) => ({
            id: `demo-${i}`, country_code: code, username: `node-${code.toLowerCase()}`,
            status: Math.random() > 0.2 ? 'online' : 'offline',
            bandwidth_mbps: Math.floor(Math.random() * 80) + 5,
            trust_score: (4 + Math.random() * 5).toFixed(1),
            current_connections: Math.floor(Math.random() * 4)
        }));
    }

    function generateDemoLinks(nodes) {
        const edges = [];
        const onlineNodes = nodes.filter(n => n.status === 'online');
        for (let i = 0; i < Math.min(8, onlineNodes.length - 1); i++) {
            edges.push({ source: onlineNodes[i].id, target: onlineNodes[(i + 1 + Math.floor(Math.random() * 3)) % onlineNodes.length].id });
        }
        return edges;
    }

    const net = networkStats?.network;

    return (
        <div className="app-layout">
            <Navbar />
            <main className="main-content">
                <div className="page-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                        <Map size={32} className="text-orange" />
                        <h1 className="page-title" style={{ marginBottom: 0 }}>Network Map</h1>
                    </div>
                    <p className="page-subtitle">Live P2P mesh visualization — drag nodes to rearrange</p>
                </div>

                {/* Stats bar */}
                <div className="grid-4" style={{ marginBottom: 24 }}>
                    <div className="stat-card"><div className="stat-label">Online Nodes</div><div className="stat-value text-orange">{net?.online_nodes || topology.nodes.length || 10}</div></div>
                    <div className="stat-card"><div className="stat-label">Active Connections</div><div className="stat-value text-purple">{networkStats?.sessions?.active_sessions || topology.edges.length || 0}</div></div>
                    <div className="stat-card"><div className="stat-label">Avg Latency</div><div className="stat-value text-green">{Math.round(net?.avg_latency || 45)}<span className="stat-unit">ms</span></div></div>
                    <div className="stat-card"><div className="stat-label">Countries</div><div className="stat-value text-orange">{net?.countries_count || 8}</div></div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20 }}>
                    {/* D3 Canvas */}
                    <div className="network-graph-container">
                        {loading ? <div className="loading-spinner" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} /> :
                            <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />}
                        <div className="flex items-center gap-2" style={{ position: 'absolute', bottom: 16, left: 16, fontSize: 11, color: 'rgba(160,174,192,0.7)' }}>
                            <MousePointer2 size={12} /> Drag nodes to move &nbsp; <Search size={12} /> Scroll to zoom &nbsp; <Info size={12} /> Click node to inspect
                        </div>
                    </div>

                    {/* Panel */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {selectedNode ? (
                            <div className="card card-glow-sunset">
                                <h4 style={{ fontWeight: 700, marginBottom: 12 }}>Selected Node</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                                    <div><span className="text-muted">Username:</span> <strong>{selectedNode.username}</strong></div>
                                    <div><span className="text-muted">Country:</span> <strong>{selectedNode.country_code}</strong></div>
                                    <div><span className="text-muted">Status:</span> <span className={`badge badge-${selectedNode.status === 'online' ? 'online' : 'offline'}`}>{selectedNode.status}</span></div>
                                    <div><span className="text-muted">Bandwidth:</span> <span className="text-orange">{parseFloat(selectedNode.bandwidth_mbps || 0).toFixed(0)} Mbps</span></div>
                                    <div><span className="text-muted">Trust Score:</span> <span className="text-purple">{parseFloat(selectedNode.trust_score || 5).toFixed(1)}</span></div>
                                    <div><span className="text-muted">Connections:</span> <strong>{selectedNode.current_connections || 0}</strong></div>
                                </div>
                            </div>
                        ) : (
                            <div className="card">
                                <div className="empty-state" style={{ padding: '30px 10px' }}>
                                    <div className="empty-state-icon"><Search size={32} /></div>
                                    <div className="empty-state-text" style={{ fontSize: 12 }}>Click a node to inspect its details</div>
                                </div>
                            </div>
                        )}

                        <div className="card">
                            <h4 style={{ fontWeight: 700, marginBottom: 12 }}>Legend</h4>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                                <div className="flex items-center gap-2"><div style={{ width: 12, height: 12, borderRadius: '50%', background: '#FF7E5F', boxShadow: '0 0 8px #FF7E5F' }} /> Online Provider</div>
                                <div className="flex items-center gap-2"><div style={{ width: 12, height: 12, borderRadius: '50%', background: '#4A5568' }} /> Offline Node</div>
                                <div className="flex items-center gap-2"><div style={{ width: 24, height: 2, background: 'rgba(107, 82, 209, 0.5)', marginTop: 2 }} /> Active Connection</div>
                                <div className="flex items-center gap-2"><div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF4D6D', boxShadow: '0 0 8px #FF4D6D' }} /> Data Packet</div>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

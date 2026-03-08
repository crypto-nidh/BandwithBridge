-- =====================================================
-- Bandwidth Bridge Database Schema
-- Migration 001: Initial Schema
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- USERS TABLE
-- Stores provider and consumer accounts
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,

    -- Role: 'provider' (shares bandwidth) or 'consumer' (uses bandwidth)
    role VARCHAR(20) NOT NULL CHECK (role IN ('provider', 'consumer', 'both')),

    username VARCHAR(50) UNIQUE NOT NULL,
    
    -- Profile info
    country_code VARCHAR(5),
    timezone VARCHAR(50),
    
    -- Account status
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    is_banned BOOLEAN DEFAULT false,
    ban_reason TEXT,
    
    -- Trust and reputation (0.0 to 10.0)
    trust_score DECIMAL(4,2) DEFAULT 5.0 CHECK (trust_score >= 0 AND trust_score <= 10),
    total_ratings INTEGER DEFAULT 0,
    
    -- Credit balance for bandwidth marketplace
    credit_balance INTEGER DEFAULT 100,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_trust_score ON users(trust_score DESC);

-- =====================================================
-- NODES TABLE
-- Represents active provider connection endpoints
-- =====================================================
CREATE TABLE IF NOT EXISTS nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Network identity (peer_id is the WebRTC/socket peer identifier)
    peer_id VARCHAR(100) UNIQUE,
    socket_id VARCHAR(100),
    
    -- Geographic location (from GeoIP or user-set)
    country_code VARCHAR(5),
    country_name VARCHAR(100),
    city VARCHAR(100),
    region VARCHAR(100),
    latitude DECIMAL(9,6),
    longitude DECIMAL(9,6),
    
    -- Network performance metrics
    latency_ms INTEGER DEFAULT 0,          -- Average latency in milliseconds
    bandwidth_mbps DECIMAL(10,2) DEFAULT 0, -- Available bandwidth in Mbps
    upload_mbps DECIMAL(10,2) DEFAULT 0,
    download_mbps DECIMAL(10,2) DEFAULT 0,
    
    -- Provider capacity settings
    max_connections INTEGER DEFAULT 5,
    current_connections INTEGER DEFAULT 0,
    max_bandwidth_mbps DECIMAL(10,2) DEFAULT 10.0,
    daily_data_limit_gb DECIMAL(10,2) DEFAULT 10.0,
    daily_data_used_gb DECIMAL(10,2) DEFAULT 0,
    
    -- Operating hours (JSON array of allowed hours 0-23)
    allowed_hours JSONB DEFAULT '[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]',
    
    -- Node status
    status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'busy', 'maintenance')),
    is_sharing BOOLEAN DEFAULT false,
    
    -- Cumulative statistics
    total_data_shared_gb DECIMAL(12,2) DEFAULT 0,
    total_sessions INTEGER DEFAULT 0,
    uptime_hours DECIMAL(10,2) DEFAULT 0,
    
    -- Trust score inherited from user (cached here for fast queries)
    trust_score DECIMAL(4,2) DEFAULT 5.0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_heartbeat_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_nodes_user_id ON nodes(user_id);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_country ON nodes(country_code);
CREATE INDEX IF NOT EXISTS idx_nodes_trust ON nodes(trust_score DESC);
CREATE INDEX IF NOT EXISTS idx_nodes_bandwidth ON nodes(bandwidth_mbps DESC);

-- =====================================================
-- SESSIONS TABLE
-- Records P2P VPN connections between consumers and providers
-- =====================================================
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Participants
    consumer_id UUID NOT NULL REFERENCES users(id),
    provider_id UUID NOT NULL REFERENCES users(id),
    consumer_node_id UUID REFERENCES nodes(id),
    provider_node_id UUID NOT NULL REFERENCES nodes(id),
    
    -- Connection info
    session_token VARCHAR(100) UNIQUE NOT NULL,
    webrtc_state VARCHAR(50) DEFAULT 'connecting',
    
    -- Multi-hop routing path (JSON array of node IDs)
    routing_path JSONB DEFAULT '[]',
    hop_count INTEGER DEFAULT 1,
    
    -- Data transfer
    bytes_sent BIGINT DEFAULT 0,
    bytes_received BIGINT DEFAULT 0,
    data_transferred_mb DECIMAL(12,2) DEFAULT 0,
    
    -- Performance
    avg_latency_ms INTEGER DEFAULT 0,
    avg_bandwidth_mbps DECIMAL(10,2) DEFAULT 0,
    packet_loss_percent DECIMAL(5,2) DEFAULT 0,
    
    -- Credits for marketplace
    credits_charged INTEGER DEFAULT 0,
    credit_rate_per_mb DECIMAL(6,4) DEFAULT 0.1,
    
    -- Session lifecycle
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('connecting', 'active', 'disconnected', 'failed', 'terminated')),
    disconnect_reason VARCHAR(100),
    
    -- Timestamps
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_consumer ON sessions(consumer_id);
CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);

-- =====================================================
-- REPUTATION RATINGS TABLE
-- Post-session ratings submitted by users
-- =====================================================
CREATE TABLE IF NOT EXISTS reputation_ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id),
    
    -- Who rated whom
    rater_id UUID NOT NULL REFERENCES users(id),
    rated_user_id UUID NOT NULL REFERENCES users(id),
    
    -- Rating dimensions (1-5 scale)
    overall_rating INTEGER NOT NULL CHECK (overall_rating >= 1 AND overall_rating <= 5),
    connection_stability INTEGER CHECK (connection_stability >= 1 AND connection_stability <= 5),
    speed_rating INTEGER CHECK (speed_rating >= 1 AND speed_rating <= 5),
    
    -- Text feedback
    comment TEXT,
    
    -- Automatic metrics (from session data)
    measured_latency_ms INTEGER,
    measured_packet_loss DECIMAL(5,2),
    measured_bandwidth_mbps DECIMAL(10,2),
    
    -- Suspicious behavior flag
    is_flagged BOOLEAN DEFAULT false,
    flag_reason TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Prevent duplicate ratings for same session
    UNIQUE(session_id, rater_id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_rated_user ON reputation_ratings(rated_user_id);
CREATE INDEX IF NOT EXISTS idx_ratings_session ON reputation_ratings(session_id);

-- =====================================================
-- CREDIT TRANSACTIONS TABLE
-- Audit trail for all credit movements in marketplace
-- =====================================================
CREATE TABLE IF NOT EXISTS credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Transaction details
    type VARCHAR(30) NOT NULL CHECK (type IN ('earn', 'spend', 'bonus', 'penalty', 'refund', 'initial')),
    amount INTEGER NOT NULL, -- Positive = earn, Negative = spend
    balance_after INTEGER NOT NULL,
    
    -- Context
    session_id UUID REFERENCES sessions(id),
    description TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credits_user ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credits_session ON credit_transactions(session_id);
CREATE INDEX IF NOT EXISTS idx_credits_created ON credit_transactions(created_at DESC);

-- =====================================================
-- NODE HEARTBEATS TABLE
-- Tracks provider availability over time
-- =====================================================
CREATE TABLE IF NOT EXISTS node_heartbeats (
    id BIGSERIAL PRIMARY KEY,
    node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    
    -- Snapshot of metrics at heartbeat time
    latency_ms INTEGER,
    bandwidth_mbps DECIMAL(10,2),
    active_connections INTEGER,
    cpu_usage_percent DECIMAL(5,2),
    memory_usage_percent DECIMAL(5,2),
    
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_heartbeats_node ON node_heartbeats(node_id);
CREATE INDEX IF NOT EXISTS idx_heartbeats_recorded ON node_heartbeats(recorded_at DESC);

-- =====================================================
-- TRIGGER: Update updated_at timestamp automatically
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_nodes_updated_at
    BEFORE UPDATE ON nodes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- INITIAL DATA: System defaults
-- =====================================================
-- Insert a sample admin user for testing
INSERT INTO users (email, password_hash, role, username, country_code, trust_score, credit_balance)
VALUES 
    ('admin@bandwidthbridge.io', '$2b$12$placeholder_will_be_set_by_seed', 'both', 'admin', 'US', 9.5, 10000)
ON CONFLICT (email) DO NOTHING;

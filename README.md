# ⚡ Bandwidth Bridge
### Decentralized P2P VPN Sharing Platform

A production-ready, peer-to-peer VPN sharing network where users share internet bandwidth with others through direct WebRTC connections — no VPN traffic passes through the central server.

---

## 🏗️ Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                   CENTRAL SERVER                         │
│   ● REST API (auth, nodes, sessions, analytics)          │
│   ● Socket.IO Signaling (SDP + ICE exchange only)        │
│   ● PostgreSQL (users, nodes, sessions, reputation)      │
│   ❌ Does NOT route VPN traffic                           │
└──────────────────────────────────────────────────────────┘
           │ signaling only │
    ┌──────▼────────────────▼──────┐
    │   Consumer Browser            │  Provider Browser   │
    │   (WebRTC peer A)             │  (WebRTC peer B)    │
    └───────────── Direct P2P WebRTC DataChannel ─────────┘
                  (VPN tunnel — no server involvement)
```

**Traffic Flow:**
1. Consumer and Provider both connect to the signaling server via Socket.IO
2. Server exchanges `SDP offer/answer` and `ICE candidates` between peers
3. WebRTC DataChannel opens directly between peers (P2P)
4. All bandwidth traffic flows through the DataChannel — never through the server

---

## 🚀 Quick Start (Docker)

### Prerequisites
- Docker Desktop installed and running
- Ports 3000, 3001, 5432 available

### Start in 3 commands:

```bash
# 1. Clone / navigate to the project
cd bandwidth-bridge

# 2. Copy environment template
copy .env.example .env

# 3. Build and start everything
docker compose up --build
```

Wait ~2-3 minutes for all services to be healthy, then open:
- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:3001
- **Health check:** http://localhost:3001/health

### Stop the application:
```bash
docker compose down
# To also delete the database:
docker compose down -v
```

---

## 📁 Project Structure

```
bandwidth-bridge/
├── backend/                    # Node.js + Express + Socket.IO
│   ├── src/
│   │   ├── index.js            # Server entry point
│   │   ├── config/db.js        # PostgreSQL pool + migrations
│   │   ├── middleware/auth.js  # JWT verification middleware
│   │   ├── controllers/        # Business logic
│   │   │   ├── authController.js
│   │   │   ├── nodeController.js
│   │   │   ├── sessionController.js
│   │   │   ├── reputationController.js
│   │   │   └── creditsController.js
│   │   ├── routes/             # Express route definitions
│   │   │   ├── auth.js
│   │   │   ├── nodes.js
│   │   │   ├── sessions.js
│   │   │   ├── reputation.js
│   │   │   ├── credits.js
│   │   │   └── analytics.js
│   │   ├── services/
│   │   │   └── peerDiscovery.js  # Scoring algorithm
│   │   ├── webrtc/
│   │   │   ├── signalingServer.js  # Socket.IO signaling
│   │   │   └── peerRegistry.js    # In-memory peer store
│   │   └── utils/logger.js
│   ├── Dockerfile
│   └── package.json
│
├── frontend/                   # React + Tailwind + D3 + Chart.js
│   ├── src/
│   │   ├── App.jsx             # Router + auth guards
│   │   ├── index.css           # Full CSS design system
│   │   ├── context/
│   │   │   └── AuthContext.jsx # JWT state management
│   │   ├── services/
│   │   │   ├── api.js          # Axios REST client
│   │   │   ├── socket.js       # Socket.IO client
│   │   │   └── webrtc.js       # WebRTC P2P manager
│   │   ├── pages/
│   │   │   ├── Login.jsx
│   │   │   ├── Register.jsx
│   │   │   ├── ProviderDashboard.jsx  # Chart.js + live metrics
│   │   │   ├── ConsumerDashboard.jsx  # Node browser + connect
│   │   │   ├── Analytics.jsx          # Bar + line charts
│   │   │   ├── NetworkMap.jsx         # D3.js force graph
│   │   │   └── Marketplace.jsx        # Credits + leaderboard
│   │   └── components/
│   │       └── Navbar.jsx
│   ├── Dockerfile
│   └── package.json
│
├── database/
│   └── migrations/
│       └── 001_init.sql        # Full schema (auto-runs on start)
│
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 🔌 API Reference

### Authentication

```bash
# Register
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"provider@test.com","password":"password123","username":"provider1","role":"provider"}'

# Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"provider@test.com","password":"password123"}'
# Returns: { "token": "eyJ..." }

# Get profile (authenticated)
curl http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer eyJ..."
```

### Nodes

```bash
# Register as provider node
curl -X POST http://localhost:3001/api/nodes/register \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"max_bandwidth_mbps":25,"daily_data_limit_gb":10,"max_connections":5,"country_code":"US"}'

# Discover available nodes (consumer)
curl "http://localhost:3001/api/nodes/discover?min_trust_score=4&limit=10" \
  -H "Authorization: Bearer eyJ..."

# Network-wide stats
curl http://localhost:3001/api/nodes/stats \
  -H "Authorization: Bearer eyJ..."
```

### Sessions

```bash
# Create VPN session
curl -X POST http://localhost:3001/api/sessions/create \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"provider_node_id":"<node-uuid>"}'

# End session
curl -X POST http://localhost:3001/api/sessions/<session-id>/end \
  -H "Authorization: Bearer eyJ..."
```

---

## 🔒 Security

| Feature | Implementation |
|---------|---------------|
| Password hashing | bcrypt (12 rounds) |
| Authentication | JWT (24h expiry) |
| Transport encryption | HTTPS/WSS (configure TLS in reverse proxy) |
| Signaling auth | JWT in Socket.IO handshake |
| Rate limiting | express-rate-limit (100 req/15min) |
| Security headers | helmet.js |
| P2P encryption | WebRTC DTLS-SRTP (built-in, mandatory) |
| SQL injection | Parameterized queries (`pg` library) |
| No traffic logging | Central server never sees VPN data |

### WebRTC Built-in Security:
All WebRTC DataChannel traffic is **end-to-end encrypted** using DTLS-SRTP. The central server only sees the initial SDP handshake (which contains no user data).

---

## 🌐 STUN/TURN Server Configuration

The application uses **Google's free public STUN servers** by default. These work for ~85% of consumer NAT configurations.

For strict NAT environments (enterprise, some mobile networks), you'll need a **TURN server**. Uncomment and configure in `.env`:

```env
TURN_SERVER=turn:your-turn-server.com:3478
TURN_USERNAME=your_username
TURN_PASSWORD=your_password
```

Free TURN options: [Metered.ca](https://www.metered.ca/) (free tier), [Twilio Network Traversal](https://www.twilio.com/docs/stun-turn).

---

## 📊 Peer Discovery Algorithm

Providers are ranked using a weighted scoring formula:

```
discovery_score = (latencyScore × 0.40) + (bandwidthScore × 0.30) + (trustScore × 0.30)

Where:
  latencyScore   = max(0, 1 - latency_ms / 500)   [0ms→1.0, 500ms→0.0]
  bandwidthScore = min(1, bandwidth_mbps / 100)    [100Mbps→1.0]
  trustScore     = trust_score / 10                [10.0→1.0]

Capacity factor applied: score × (1 - current_connections/max_connections × 0.5)
```

---

## 💰 Credit Economy

| Action | Credits |
|--------|---------|
| Account creation bonus | +100 |
| Per MB served (provider) | +0.1 |
| Per MB consumed | -0.1 |
| Session minimum | 10 credits |

---

## 🐛 Troubleshooting

**Docker won't start:**
```bash
docker compose logs backend
docker compose logs postgres
```

**Frontend can't reach backend:**
- Ensure `REACT_APP_API_URL=http://localhost:3001` in frontend env

**WebRTC not connecting:**
- Check browser console for ICE candidate errors
- Try on same local network first (removes NAT issues)
- Add a TURN server if on strict NAT

**Database connection error:**
```bash
# Check postgres is healthy
docker compose ps
# Reset database
docker compose down -v && docker compose up --build
```

---

## 📄 License

MIT License — Free for personal and commercial use.

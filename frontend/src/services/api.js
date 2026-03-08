/**
 * API Service
 * 
 * Centralized Axios HTTP client for all REST API calls.
 * Automatically attaches JWT token from local storage.
 * Handles 401 errors by clearing auth and redirecting to login.
 */

import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const api = axios.create({
    baseURL: API_BASE,
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' }
});

// Request interceptor: attach JWT token
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('bb_token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Response interceptor: handle auth expiry
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('bb_token');
            localStorage.removeItem('bb_user');
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

// ---- Auth API ----
export const authAPI = {
    register: (data) => api.post('/api/auth/register', data),
    login: (data) => api.post('/api/auth/login', data),
    getMe: () => api.get('/api/auth/me'),
    updateProfile: (data) => api.put('/api/auth/profile', data),
    getIceServers: () => api.get('/api/webrtc/ice-servers')
};

// ---- Nodes API ----
export const nodesAPI = {
    register: (data) => api.post('/api/nodes/register', data),
    updateStatus: (data) => api.patch('/api/nodes/status', data),
    heartbeat: (data) => api.post('/api/nodes/heartbeat', data),
    getMine: () => api.get('/api/nodes/mine'),
    discover: (params) => api.get('/api/nodes/discover', { params }),
    getStats: () => api.get('/api/nodes/stats'),
    getTopology: () => api.get('/api/nodes/topology')
};

// ---- Sessions API ----
export const sessionsAPI = {
    create: (data) => api.post('/api/sessions/create', data),
    updateMetrics: (sessionId, data) => api.patch(`/api/sessions/${sessionId}/metrics`, data),
    end: (sessionId, data) => api.post(`/api/sessions/${sessionId}/end`, data),
    getHistory: (params) => api.get('/api/sessions/history', { params }),
    getActive: () => api.get('/api/sessions/active')
};

// ---- Reputation API ----
export const reputationAPI = {
    submitRating: (data) => api.post('/api/reputation/rate', data),
    getUserReputation: (userId) => api.get(`/api/reputation/${userId}`)
};

// ---- Credits API ----
export const creditsAPI = {
    getBalance: () => api.get('/api/credits/balance'),
    getMarketplace: () => api.get('/api/credits/marketplace')
};

// ---- Analytics API ----
export const analyticsAPI = {
    getOverview: () => api.get('/api/analytics/overview'),
    getBandwidth: (days) => api.get('/api/analytics/bandwidth', { params: { days } }),
    getSessions: (days) => api.get('/api/analytics/sessions', { params: { days } })
};

export default api;

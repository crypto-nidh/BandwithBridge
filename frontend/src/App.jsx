/**
 * App.jsx - Root Application Component
 * 
 * Sets up React Router with protected routes.
 * Wraps everything in AuthProvider for JWT state.
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Register from './pages/Register';
import ProviderDashboard from './pages/ProviderDashboard';
import ConsumerDashboard from './pages/ConsumerDashboard';
import Analytics from './pages/Analytics';
import NetworkMap from './pages/NetworkMap';
import Marketplace from './pages/Marketplace';
import './index.css';

// Protected route wrapper
function PrivateRoute({ children }) {
    const { isAuthenticated, loading } = useAuth();
    if (loading) return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
            <div className="loading-spinner" />
        </div>
    );
    return isAuthenticated ? children : <Navigate to="/login" replace />;
}

// Public route: redirect to dashboard if already logged in
function PublicRoute({ children }) {
    const { isAuthenticated, loading } = useAuth();
    if (loading) return null;
    return !isAuthenticated ? children : <Navigate to="/consumer" replace />;
}

function AppRoutes() {
    return (
        <Routes>
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
            <Route path="/provider" element={<PrivateRoute><ProviderDashboard /></PrivateRoute>} />
            <Route path="/consumer" element={<PrivateRoute><ConsumerDashboard /></PrivateRoute>} />
            <Route path="/analytics" element={<PrivateRoute><Analytics /></PrivateRoute>} />
            <Route path="/network" element={<PrivateRoute><NetworkMap /></PrivateRoute>} />
            <Route path="/marketplace" element={<PrivateRoute><Marketplace /></PrivateRoute>} />
            <Route path="/" element={<Navigate to="/consumer" replace />} />
        </Routes>
    );
}

export default function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <AppRoutes />
            </BrowserRouter>
        </AuthProvider>
    );
}

/**
 * Authentication Context
 * 
 * Provides JWT-based authentication state to all components.
 * Stores token and user info in localStorage for persistence.
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem('bb_token'));
    const [loading, setLoading] = useState(true);

    // On app load, verify token and fetch user
    useEffect(() => {
        const init = async () => {
            const storedToken = localStorage.getItem('bb_token');
            if (storedToken) {
                try {
                    const res = await authAPI.getMe();
                    setUser(res.data.user);
                } catch {
                    // Token expired or invalid
                    localStorage.removeItem('bb_token');
                    localStorage.removeItem('bb_user');
                    setToken(null);
                }
            }
            setLoading(false);
        };
        init();
    }, []);

    const login = async (email, password) => {
        const res = await authAPI.login({ email, password });
        const { token: newToken, user: newUser } = res.data;
        localStorage.setItem('bb_token', newToken);
        localStorage.setItem('bb_user', JSON.stringify(newUser));
        setToken(newToken);
        setUser(newUser);
        return newUser;
    };

    const register = async (formData) => {
        const res = await authAPI.register(formData);
        const { token: newToken, user: newUser } = res.data;
        localStorage.setItem('bb_token', newToken);
        localStorage.setItem('bb_user', JSON.stringify(newUser));
        setToken(newToken);
        setUser(newUser);
        return newUser;
    };

    const logout = () => {
        localStorage.removeItem('bb_token');
        localStorage.removeItem('bb_user');
        setToken(null);
        setUser(null);
    };

    const updateUserLocally = (updates) => {
        setUser(prev => ({ ...prev, ...updates }));
    };

    return (
        <AuthContext.Provider value={{
            user, token, loading,
            login, register, logout, updateUserLocally,
            isAuthenticated: !!user
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
};

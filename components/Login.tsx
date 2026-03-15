import React, { useState } from 'react';
import { User } from '../types.ts';
import { Logo } from './Logo.tsx';

interface LoginProps {
  onLogin: (user: User) => void;
}

const USERS = [
  { username: 'ironman1111', password: 'YaKareem1121@', displayName: 'Iron Command', role: 'Chief Engineer' },
  { username: 'batbout', password: 'batto123', displayName: 'Logistics Hub', role: 'Logistics Specialist' }
];

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    setTimeout(() => {
      const found = USERS.find(u => u.username === username && u.password === password);
      if (found) {
        onLogin({
          username: found.username,
          displayName: found.displayName,
          role: found.role
        });
      } else {
        setError('UNAUTHORIZED: INVALID ACCESS CREDENTIALS');
        setLoading(false);
      }
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-cat-black flex items-center justify-center p-6 relative overflow-hidden font-sans">
      {/* Industrial Background Elements */}
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #ffcd00 1px, transparent 0)', backgroundSize: '40px 40px' }}></div>
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-cat-black via-transparent to-cat-black"></div>
      </div>

      <div className="absolute top-1/4 -left-20 w-96 h-96 bg-cat-yellow/10 rounded-full blur-[120px] animate-pulse"></div>
      <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-cat-yellow/5 rounded-full blur-[120px] animate-pulse delay-700"></div>

      <div className="w-full max-w-lg relative z-10 fade-in">
        <div className="flex flex-col items-center mb-10">
          <div className="bg-white p-10 rounded-[2.5rem] border-4 border-cat-yellow shadow-3xl mb-8 transform hover:scale-105 transition-all duration-500 shadow-cat-yellow/20">
            <Logo className="h-28 w-auto object-contain" />
          </div>
          <h1 className="text-4xl font-black text-white uppercase tracking-tighter mb-2">Command Center</h1>
          <div className="flex items-center gap-4 mt-2 w-full justify-center">
            <div className="h-[2px] flex-grow max-w-[60px] bg-cat-yellow/30"></div>
            <p className="text-[11px] text-cat-yellow font-black uppercase tracking-[0.4em]">American Iron LLC • Secure Access</p>
            <div className="h-[2px] flex-grow max-w-[60px] bg-cat-yellow/30"></div>
          </div>
        </div>

        <div className="bg-white/5 backdrop-blur-2xl p-12 rounded-[3rem] border border-white/10 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.8)] relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-cat-yellow shadow-[0_0_20px_rgba(255,205,0,0.5)]"></div>
          
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="space-y-2.5">
              <label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 ml-4">Operator Identity</label>
              <div className="relative">
                <input 
                  type="text" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-[1.5rem] p-6 text-white font-bold text-base focus:bg-white/10 focus:border-cat-yellow outline-none transition-all placeholder:text-slate-700 pl-16 shadow-inner"
                  placeholder="USERNAME"
                  required
                />
                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-cat-yellow opacity-40">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              <label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 ml-4">Security Protocol</label>
              <div className="relative">
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-[1.5rem] p-6 text-white font-bold text-base focus:bg-white/10 focus:border-cat-yellow outline-none transition-all placeholder:text-slate-700 pl-16 shadow-inner"
                  placeholder="PASSWORD"
                  required
                />
                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-cat-yellow opacity-40">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 p-5 rounded-2xl flex items-center gap-4 animate-in slide-in-from-top-2 duration-300">
                <div className="w-10 h-10 rounded-xl bg-red-500 flex items-center justify-center text-white shrink-0 shadow-lg">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                </div>
                <p className="text-[11px] font-black text-red-400 uppercase tracking-tight">{error}</p>
              </div>
            )}

            <button 
              type="submit" 
              disabled={loading}
              className={`w-full py-8 rounded-[1.5rem] font-black text-xl uppercase tracking-[0.4em] flex items-center justify-center gap-6 transition-all shadow-2xl relative overflow-hidden group ${loading ? 'bg-cat-yellow/20 text-cat-yellow/40 cursor-not-allowed' : 'bg-cat-yellow text-cat-black hover:bg-white active:scale-[0.98]'}`}
            >
              {loading ? (
                <>
                  <div className="w-7 h-7 border-4 border-cat-black/10 border-t-cat-black rounded-full animate-spin"></div>
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <span>Initialize</span>
                  <svg className="w-7 h-7 group-hover:translate-x-3 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg>
                </>
              )}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
            </button>
          </form>

          <div className="mt-12 pt-8 border-t border-white/5 flex justify-between items-center">
            <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">Authorized Personnel Only</p>
            <div className="flex gap-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">System Online</span>
              </div>
            </div>
          </div>
        </div>
        
        <p className="text-center mt-10 text-[11px] text-slate-600 font-black uppercase tracking-[0.4em]">© 2024 American Iron LLC • Industrial Grade Logistics</p>
      </div>
    </div>
  );
};
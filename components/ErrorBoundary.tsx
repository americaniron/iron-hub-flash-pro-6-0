import React, { ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Standard React Error Boundary.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render = () => {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-cat-black flex items-center justify-center p-6 relative overflow-hidden">
          <div className="absolute inset-0 opacity-20 pointer-events-none">
            <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #ffcd00 1px, transparent 0)', backgroundSize: '40px 40px' }}></div>
          </div>
          <div className="max-w-xl w-full bg-white/5 backdrop-blur-2xl p-12 rounded-[3.5rem] shadow-3xl border border-white/10 text-center animate-in fade-in relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.5)]"></div>

            <div className="w-24 h-24 bg-red-500 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-red-500/20">
              <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            </div>

            <h2 className="text-4xl font-black uppercase text-white tracking-tighter mb-4">Critical System Fault</h2>
            <p className="text-slate-400 text-sm mb-10 leading-relaxed font-bold uppercase tracking-tight">
              The Engineering Hub encountered an unrecoverable error. Your local data has been preserved.
            </p>

            <button
              onClick={() => window.location.reload()}
              className="w-full bg-cat-yellow text-cat-black font-black py-6 rounded-2xl uppercase tracking-[0.4em] hover:bg-white transition-all shadow-2xl active:scale-[0.98] group flex items-center justify-center gap-4"
            >
              <span>Reboot Hub</span>
              <svg className="w-6 h-6 group-hover:rotate-180 transition-transform duration-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

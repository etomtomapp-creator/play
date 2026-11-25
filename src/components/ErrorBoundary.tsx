import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    let friendly = 'An unexpected error occurred in SyncWatch.';
    try {
      const parsed = JSON.parse(error.message) as { error?: string; operationType?: string };
      if (parsed.error && parsed.operationType) {
        friendly = `Cloud sync permission notice (${parsed.operationType}): ${parsed.error}`;
      }
    } catch {
      if (error?.message) {
        friendly = error.message;
      }
    }
    return { hasError: true, message: friendly };
  }

  componentDidCatch(error: Error) {
    console.error('SyncWatch ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#06070D] text-[#F4F5FA] flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl bg-[#0D1020] border border-white/10 p-6 text-center space-y-5">
            <div className="w-12 h-12 rounded-xl bg-rose-500/15 text-rose-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
              <p className="text-sm text-slate-400 leading-relaxed">{this.state.message}</p>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center gap-2 w-full min-h-[44px] px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              Reload SyncWatch
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

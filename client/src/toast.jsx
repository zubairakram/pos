import { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);
let counter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback((type, message) => {
    const id = ++counter;
    setToasts((list) => [...list, { id, type, message }]);
    setTimeout(() => remove(id), 4500);
  }, [remove]);

  const toast = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
    warning: (m) => push('warning', m),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => {
          const Icon = t.type === 'success' ? CheckCircle2 : t.type === 'error' ? XCircle : t.type === 'warning' ? AlertTriangle : Info;
          return (
            <div key={t.id} className={`toast toast-${t.type}`}>
              <Icon size={18} />
              <span>{t.message}</span>
              <button onClick={() => remove(t.id)} aria-label="Dismiss"><X size={15} /></button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

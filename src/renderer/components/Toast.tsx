import React, { useEffect, useState, useCallback } from 'react';

export interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'error';
  text: string;
}

let addToastFn: ((msg: Omit<ToastMessage, 'id'>) => void) | null = null;

export function showToast(type: ToastMessage['type'], text: string) {
  addToastFn?.({ type, text });
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((msg: Omit<ToastMessage, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { ...msg, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  const bgColor = (type: string) => {
    switch (type) {
      case 'success': return 'bg-green-500/90';
      case 'error': return 'bg-red-500/90';
      default: return 'bg-gray-700/90';
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`
            ${bgColor(toast.type)} text-white text-xs px-4 py-2.5 rounded-lg shadow-lg
            pointer-events-auto animate-slide-up backdrop-blur-sm max-w-[300px]
          `}
        >
          {toast.text}
        </div>
      ))}
    </div>
  );
}

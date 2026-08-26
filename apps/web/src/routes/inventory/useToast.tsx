/**
 * The little black bar that says "Added Milk". Shared by the pantry list and the add page
 * because a save on the add page navigates away -- the message has to be handed to the
 * page you land on, not shown on the one you left.
 */
import { useEffect, useRef, useState } from 'react';

export type ToastKind = 'info' | 'error';

export interface Toast {
  msg: string;
  kind: ToastKind;
}

export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  function showToast(msg: string, kind: ToastKind = 'info') {
    setToast({ msg, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }

  return { toast, showToast };
}

export function ToastBar({ toast }: { toast: Toast | null }) {
  if (!toast) return null;
  return (
    <p
      role="status"
      className={`fixed inset-x-4 bottom-4 z-[60] mx-auto max-w-md rounded-card px-4 py-3 text-center text-sm font-semibold text-white shadow-lg ${
        toast.kind === 'error' ? 'bg-warn' : 'bg-ink'
      }`}
    >
      {toast.msg}
    </p>
  );
}

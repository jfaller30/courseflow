import React from "react";
import { createPortal } from "react-dom";

/**
 * Minimal Dialog implementation with robust portal host creation.
 * - Exports Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
 * - Uses Tailwind-friendly classes to fit your project
 */

const DialogContext = React.createContext({ open: false, onOpenChange: () => {} });

export function Dialog({ open = false, onOpenChange = () => {}, children }) {
  // State to hold the portal host element
  const [host, setHost] = React.useState(null);

  React.useEffect(() => {
    // Ensure a portal root exists (synchronously create in effect)
    const rootId = "dialog-root";
    let root = document.getElementById(rootId);
    if (!root) {
      root = document.createElement("div");
      root.id = rootId;
      document.body.appendChild(root);
    }
    setHost(root);

    // optional cleanup: don't remove the host on unmount because other components might reuse it
    return () => {
      // If you want to remove the root when no longer used, you'd need a refcount; skip for simplicity.
    };
  }, []);

  // Don't attempt portal until host exists (prevents "Target container is not a DOM element")
  if (!host) return null;

  const value = { open, onOpenChange };

  return createPortal(
    <DialogContext.Provider value={value}>{children}</DialogContext.Provider>,
    host
  );
}

export function DialogContent({ children, className = "" }) {
  const ctx = React.useContext(DialogContext);
  if (!ctx || !ctx.open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => ctx.onOpenChange(false)}
      />
      {/* Panel */}
      <div
        className={[
          "relative z-10 w-[min(96%,560px)] max-h-[90vh] overflow-auto bg-white dark:bg-slate-900 rounded-2xl shadow-lg p-4",
          className,
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export const DialogHeader = ({ children, className = "" }) => (
  <div className={["mb-2", className].join(" ")}>{children}</div>
);
export const DialogTitle = ({ children, className = "" }) => (
  <h2 className={["text-lg font-semibold", className].join(" ")}>{children}</h2>
);
export const DialogDescription = ({ children, className = "" }) => (
  <div className={["text-sm text-slate-600 whitespace-pre-line", className].join(" ")}>{children}</div>
);
export const DialogFooter = ({ children, className = "" }) => (
  <div className={["mt-4 flex justify-end gap-2", className].join(" ")}>{children}</div>
);

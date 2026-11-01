import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMarkAllRead, useMarkRead, useNotifications } from "../../hooks/useNotifications";
import { useNow } from "../../hooks/useNow";
import { relativeTime } from "../../lib/format";
import type { Notification } from "../../services/types";
import { Icon } from "../ui/Icon";
import { Spinner } from "../ui/Spinner";

const SEVERITY_DOT: Record<string, string> = {
  SUCCESS: "bg-money-500",
  ERROR: "bg-loss",
  WARNING: "bg-warn",
  INFO: "bg-ink-400",
};

export function NotificationBell({ fallbackUnread = 0 }: { fallbackUnread?: number }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError, refetch } = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const navigate = useNavigate();
  const now = useNow(30_000);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const unread = data?.unread ?? fallbackUnread;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const openItem = (n: Notification) => {
    if (!n.is_read) markRead.mutate(n.notification_id);
    setOpen(false);
    if (n.link && n.link.startsWith("/") && !n.link.startsWith("//")) navigate(n.link);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100 hover:text-ink-900"
      >
        <Icon name="bell" className="h-5 w-5" />
        {unread > 0 && (
          <span className="num absolute -top-0.5 -right-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-money-600 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="region"
          aria-label="Notifications"
          className="fixed inset-x-3 top-[7.25rem] z-40 animate-slide-up overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-[380px]"
        >
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <p className="text-sm font-bold text-ink-900">
              Notifications {unread > 0 && <span className="ml-1 font-medium text-ink-500">· {unread} unread</span>}
            </p>
            <button
              type="button"
              onClick={() => markAll.mutate()}
              disabled={unread === 0 || markAll.isPending}
              className="text-xs font-semibold text-money-700 hover:underline disabled:text-ink-300 disabled:no-underline"
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto sm:max-h-[420px]">
            {isLoading ? (
              <div className="flex justify-center py-8 text-money-600">
                <Spinner />
              </div>
            ) : isError ? (
              <div className="px-4 py-6 text-center text-sm text-ink-600">
                Couldn't load notifications.{" "}
                <button type="button" className="font-semibold text-money-700 hover:underline" onClick={() => refetch()}>
                  Retry
                </button>
              </div>
            ) : !data || data.items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-ink-500">You're all caught up.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {data.items.map((n) => (
                  <li key={n.notification_id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-ink-50 ${n.is_read ? "" : "bg-money-50/50"}`}
                    >
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[n.severity] ?? "bg-ink-400"} ${n.is_read ? "opacity-30" : ""}`} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm ${n.is_read ? "font-medium text-ink-700" : "font-semibold text-ink-900"}`}>{n.title}</span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-ink-500">{n.message}</span>
                        <span className="mt-1 block text-[11px] font-medium text-ink-400">
                          {relativeTime(n.created_at, new Date(now))}
                          {!n.is_read && <span className="sr-only"> · unread</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

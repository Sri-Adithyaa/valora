import { Icon } from "./ui/Icon";

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-ink-100 px-5 py-3 text-sm">
      <p className="text-ink-500">
        <span className="num">{start}–{end}</span> of <span className="num">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50 disabled:opacity-40"
          aria-label="Previous page"
        >
          <Icon name="chevron-left" className="h-4 w-4" />
        </button>
        <span className="num px-2 text-ink-600">{page} / {pages}</span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50 disabled:opacity-40"
          aria-label="Next page"
        >
          <Icon name="chevron-right" className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}

import type { LucidFile } from "@lucid/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PageProblem, PageSummary } from "../../electron/ipc/types";

const LAST_PAGE_KEY = "lucid.lastPage";

function remembered(): string | undefined {
  try {
    return localStorage.getItem(LAST_PAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
function remember(id: string | undefined): void {
  try {
    if (id) localStorage.setItem(LAST_PAGE_KEY, id);
    else localStorage.removeItem(LAST_PAGE_KEY);
  } catch {
    // Remembering the last page is a convenience only.
  }
}

const summaryOf = (f: LucidFile, fileName: string): PageSummary => ({
  id: f.id,
  title: f.title,
  updatedAt: f.updatedAt,
  fileName,
  ...(f.meta.format ? { format: f.meta.format } : {}),
});

/** The page list and the open page. Opening, creating and deleting go through the library in the main process. */
export function usePages() {
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [problems, setProblems] = useState<PageProblem[]>([]);
  const [current, setCurrent] = useState<LucidFile | undefined>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const opening = useRef(0);

  const open = useCallback(async (id: string) => {
    const mine = ++opening.current;
    try {
      const file = await window.lucid.pages.load(id);
      if (mine !== opening.current) return;
      setCurrent(file);
      remember(file.id);
      setError(undefined);
    } catch (e) {
      if (mine === opening.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const listed = await window.lucid.pages.list();
        setPages(listed.pages);
        setProblems(listed.problems);
        const wanted = remembered();
        const first = listed.pages.find((p) => p.id === wanted) ?? listed.pages[0];
        if (first) await open(first.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setReady(true);
      }
    })();
  }, [open]);

  // An agent changed a page that is not open: list again so titles and times are right.
  useEffect(
    () =>
      window.lucid.pages.onChanged(() => {
        void window.lucid.pages.list().then((listed) => {
          setPages(listed.pages);
          setProblems(listed.problems);
        });
      }),
    [],
  );

  const create = useCallback(async (options?: { title?: string; format?: string }) => {
    try {
      const file = await window.lucid.pages.create(
        options?.title,
        options?.format ? { format: options.format } : undefined,
      );
      opening.current++;
      setPages((list) => [summaryOf(file, `${file.id}.lucid`), ...list]);
      setCurrent(file);
      remember(file.id);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const trash = useCallback(
    async (id: string) => {
      try {
        await window.lucid.pages.trash(id);
        const rest = pages.filter((p) => p.id !== id);
        setPages(rest);
        if (current?.id === id) {
          setCurrent(undefined);
          remember(undefined);
          const next = rest[0];
          if (next) await open(next.id);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [pages, current, open],
  );

  /** The notes on disk changed (some were imported): list again, and open one of them if asked. */
  const reload = useCallback(
    async (openId?: string) => {
      try {
        const listed = await window.lucid.pages.list();
        setPages(listed.pages);
        setProblems(listed.problems);
        if (openId) await open(openId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [open],
  );

  /** A save finished: refresh the sidebar entry (title and time). */
  const saved = useCallback((file: LucidFile) => {
    setPages((list) => {
      const old = list.find((p) => p.id === file.id);
      const next = list.map((p) =>
        p.id === file.id ? summaryOf(file, old?.fileName ?? p.fileName) : p,
      );
      return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }, []);

  return { pages, problems, current, ready, error, open, create, trash, saved, reload };
}

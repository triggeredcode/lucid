import { useEffect, useRef, useState } from "react";
import { startAgentBridge } from "./agent/bridge";
import { NewPageDialog } from "./pages/NewPageDialog";
import { SettingsDialog } from "./settings/SettingsDialog";
import { loadSettings } from "./settings/settingsStore";
import type { NoteImportResult, PublicSettings } from "../electron/ipc/types";
import { ImportNotice } from "./pages/ImportNotice";
import { Sidebar } from "./pages/Sidebar";
import { Workspace } from "./pages/Workspace";
import { usePages } from "./pages/usePages";

export function App() {
  if (typeof window.lucid === "undefined") {
    return (
      <div className="blank">
        <h1>Lucid needs its desktop window.</h1>
        <p>
          Start it with <code>pnpm dev</code>.
        </p>
      </div>
    );
  }
  return <Shell />;
}

const SIDEBAR_KEY = "lucid.sidebar";

function Shell() {
  const pages = usePages();
  useEffect(() => {
    startAgentBridge();
  }, []);
  const [settings, setSettings] = useState<PublicSettings | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newPageOpen, setNewPageOpen] = useState(false);
  const [imported, setImported] = useState<NoteImportResult | undefined>();

  /** Brings in notes from `.lucid` files, and opens the first one that came in. */
  const importNotes = async () => {
    try {
      const result = await window.lucid.note.import();
      if (!result) return;
      setImported(result);
      await pages.reload(result.imported[0]?.id);
    } catch (error) {
      setImported({
        imported: [],
        problems: [
          { fileName: "", message: error instanceof Error ? error.message : String(error) },
        ],
      });
    }
  };
  const importRef = useRef(importNotes);
  importRef.current = importNotes;
  // File → Import Note… (⌘O) does the same as the button in the pages list.
  useEffect(
    () =>
      window.lucid.note.onMenu((action) => {
        if (action === "import-note") void importRef.current();
      }),
    [],
  );
  const openSettings = () => {
    void loadSettings().then((s) => {
      setSettings(s);
      setSettingsOpen(true);
    });
  };
  useEffect(() => {
    void loadSettings();
    // ⌘, opens Settings, as in most Mac apps.
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        openSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) !== "closed";
    } catch {
      return true;
    }
  });
  const toggleSidebar = () => {
    setSidebarOpen((open) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, open ? "closed" : "open");
      } catch {
        // Remembering is a convenience only.
      }
      return !open;
    });
  };
  return (
    <div className="app" data-sidebar={sidebarOpen ? "open" : "closed"}>
      {sidebarOpen && (
        <Sidebar
          pages={pages.pages}
          problems={pages.problems}
          currentId={pages.current?.id}
          onOpen={(id) => void pages.open(id)}
          onCreate={() => void pages.create()}
          onCreateFrom={() => {
            setNewPageOpen(true);
          }}
          onImport={() => void importNotes()}
          onTrash={(id) => void pages.trash(id)}
          onHide={toggleSidebar}
          onSettings={openSettings}
        />
      )}
      <main className="main-area">
        {pages.error && (
          <div className="banner" role="alert">
            {pages.error}
          </div>
        )}
        {imported && (
          <ImportNotice
            result={imported}
            onClose={() => {
              setImported(undefined);
            }}
          />
        )}
        {pages.current ? (
          <Workspace
            key={pages.current.id}
            file={pages.current}
            onSaved={pages.saved}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={toggleSidebar}
          />
        ) : pages.ready ? (
          <div className="blank">
            <h1>Think out loud. Lucid writes it up.</h1>
            <p>
              Say or type what you’re learning. Lucid turns it into notes, diagrams and tables, and
              makes the PDF.
            </p>
            <button className="primary big" type="button" onClick={() => void pages.create()}>
              + New page
            </button>
            <ol className="first-steps">
              <li>
                <b>Start LM Studio</b> and load a model. The pill at the top says when it is ready.
              </li>
              <li>
                <b>Make a page</b> and say or type what you’re learning.
              </li>
              <li>
                <b>Download PDF</b> when it looks right. The first one takes a few minutes: Lucid
                gets its typesetting files once.
              </li>
            </ol>
            <p className="first-steps-help">
              New here? Help → Lucid Guide explains every part of the window.
            </p>
          </div>
        ) : null}
      </main>
      {newPageOpen && (
        <NewPageDialog
          onClose={() => {
            setNewPageOpen(false);
          }}
          onCreate={(page) => {
            setNewPageOpen(false);
            void pages.create(page);
          }}
        />
      )}
      {settingsOpen && settings && (
        <SettingsDialog
          settings={settings}
          onClose={() => {
            setSettingsOpen(false);
          }}
        />
      )}
    </div>
  );
}

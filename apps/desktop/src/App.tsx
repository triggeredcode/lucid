import { useCallback, useEffect, useRef, useState } from "react";
import { startAgentBridge } from "./agent/bridge";
import { NewPageDialog } from "./pages/NewPageDialog";
import { SettingsDialog } from "./settings/SettingsDialog";
import { loadSettings } from "./settings/settingsStore";
import type { NoteImportResult, PublicSettings } from "../electron/ipc/types";
import { ImportNotice } from "./pages/ImportNotice";
import { Sidebar } from "./pages/Sidebar";
import { Workspace } from "./pages/Workspace";
import { usePages } from "./pages/usePages";
import { FirstRun } from "./onboarding/FirstRun";
import { FirstSuccessGuide } from "./onboarding/FirstSuccessGuide";
import { completeOnboarding, onboardingComplete } from "./onboarding/state";
import {
  finishActivation,
  loadActivationProgress,
  pauseActivation,
  recordMilestone,
  rememberActivationPage,
  resumeActivation,
  type ActivationMilestone,
} from "./onboarding/activation";

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
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [activation, setActivation] = useState(loadActivationProgress);
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
    void loadSettings().then((loaded) => {
      setSettings(loaded);
      if (loaded.onboardingDisabled) return;
      if (!onboardingComplete()) {
        setOnboardingOpen(true);
        return;
      }
      const progress = loadActivationProgress();
      setActivation(progress);
      if (!progress.finished && !progress.paused) setGuideOpen(true);
    });
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
  const finishOnboarding = (startTour: boolean) => {
    completeOnboarding();
    setOnboardingOpen(false);
    const latest = loadActivationProgress();
    setActivation(startTour ? resumeActivation(latest) : pauseActivation(latest));
    setGuideOpen(startTour);
  };
  const noteMilestone = useCallback((milestone: ActivationMilestone) => {
    setActivation((current) => recordMilestone(current, milestone));
  }, []);
  const createFirstPage = useCallback(
    async (options?: { title?: string; format?: string }) => {
      const file = await pages.create(options);
      if (!file) return;
      setActivation((current) =>
        recordMilestone(rememberActivationPage(current, file.id), "page-created"),
      );
    },
    [pages.create],
  );
  useEffect(() => {
    const currentPage = pages.current;
    if (!guideOpen || !currentPage || activation.milestones.includes("page-created")) return;
    setActivation((current) =>
      recordMilestone(rememberActivationPage(current, currentPage.id), "page-created"),
    );
  }, [activation.milestones, guideOpen, pages.current]);
  return (
    <div className="app" data-sidebar={sidebarOpen ? "open" : "closed"}>
      {sidebarOpen && (
        <Sidebar
          pages={pages.pages}
          problems={pages.problems}
          currentId={pages.current?.id}
          onOpen={(id) => void pages.open(id)}
          onCreate={() => void createFirstPage()}
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
            onRestoreBackup={pages.restoreBackup}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={toggleSidebar}
            onActivationMilestone={noteMilestone}
          />
        ) : pages.ready ? (
          <div className="blank">
            <h1>Start with a page.</h1>
            <p>Write freely. Structure can come later.</p>
            <button className="primary big" type="button" onClick={() => void createFirstPage()}>
              + New page
            </button>
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
            void createFirstPage(page);
          }}
        />
      )}
      {settingsOpen && settings && (
        <SettingsDialog
          settings={settings}
          onClose={() => {
            setSettingsOpen(false);
          }}
          onOpenOnboarding={() => {
            setSettingsOpen(false);
            setOnboardingOpen(true);
          }}
        />
      )}
      {onboardingOpen && settings && (
        <FirstRun settings={settings} onSettingsChange={setSettings} onFinish={finishOnboarding} />
      )}
      {guideOpen && (
        <FirstSuccessGuide
          progress={activation}
          onCreatePage={() => void createFirstPage()}
          onPause={() => {
            setActivation((current) => pauseActivation(current));
            setGuideOpen(false);
          }}
          onFinish={() => {
            setActivation((current) => finishActivation(current));
            setGuideOpen(false);
          }}
        />
      )}
    </div>
  );
}

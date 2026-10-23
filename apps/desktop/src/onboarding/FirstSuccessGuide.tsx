import { useEffect, useState, type CSSProperties } from "react";
import {
  hasAiFirstSuccess,
  hasBasicFirstSuccess,
  type ActivationMilestone,
  type ActivationProgress,
} from "./activation";

interface Props {
  progress: ActivationProgress;
  onCreatePage: () => void;
  onPause: () => void;
  onFinish: () => void;
}

interface TourStep {
  title: string;
  text: string;
  target?: string;
}

const done = (progress: ActivationProgress, milestone: ActivationMilestone): boolean =>
  progress.milestones.includes(milestone);

function nextStep(progress: ActivationProgress): TourStep {
  if (!done(progress, "page-created")) {
    return {
      title: "Create a page",
      text: "Start with a blank page. Lucid will keep the rest of this guide beside the action you need.",
      target: '[data-tour="new-page"]',
    };
  }
  if (!done(progress, "content-added")) {
    return progress.provider === "ready"
      ? {
          title: "Add a thought",
          text: "Type or speak a few sentences here, then press Enter.",
          target: ".dictation-box textarea",
        }
      : {
          title: "Write on the page",
          text: "Choose Edit, then type directly in the page. AI can be connected later.",
          target: '.mode-option[data-mode="edit"]',
        };
  }
  if (progress.provider === "ready" && !done(progress, "command-applied")) {
    return {
      title: "Make one change",
      text: "Choose Command and ask Lucid to revise something already on the page.",
      target: '.mode-option[data-mode="command"]',
    };
  }
  if (progress.provider === "ready" && !done(progress, "visual-created")) {
    return {
      title: "Build a visual",
      text: "Choose Diagram or Table. Lucid will guide the structure one decision at a time.",
      target: ".mode-option.build",
    };
  }
  if (!done(progress, "export-saved")) {
    return {
      title: "Export when you are ready",
      text: "Open page actions, then choose PDF, Markdown, or an editable Lucid note.",
      target: ".workspace-menu > summary",
    };
  }
  return {
    title: hasAiFirstSuccess(progress) ? "That is the full Lucid flow" : "Your first page is ready",
    text: hasAiFirstSuccess(progress)
      ? "You captured, revised, visualized, and exported a real page."
      : "You created, edited, and exported a real page. Connect AI whenever you need it.",
  };
}

/** A contextual tour that points at the real control instead of describing a diagram of the app. */
export function FirstSuccessGuide({ progress, onCreatePage, onPause, onFinish }: Props) {
  const step = nextStep(progress);
  const basicComplete = hasBasicFirstSuccess(progress);
  const [position, setPosition] = useState<CSSProperties>();

  useEffect(() => {
    if (!step.target) {
      setPosition(undefined);
      return;
    }
    const target = document.querySelector<HTMLElement>(step.target);
    if (!target) {
      setPosition(undefined);
      return;
    }
    target.classList.add("tour-target");
    const update = () => {
      const rect = target.getBoundingClientRect();
      const width = 320;
      const left =
        rect.right + width + 28 < window.innerWidth
          ? rect.right + 14
          : Math.min(Math.max(14, rect.left), window.innerWidth - width - 14);
      const top =
        rect.bottom + 190 < window.innerHeight ? rect.bottom + 12 : Math.max(14, rect.top - 174);
      setPosition({ left, top });
    };
    update();
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      target.classList.remove("tour-target");
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [step.target]);

  return (
    <aside
      className="first-success-guide"
      aria-label="First success guide"
      data-anchored={position ? "true" : "false"}
      style={position}
    >
      <button
        type="button"
        className="icon-button tour-close"
        aria-label="Skip tour"
        onClick={onPause}
      >
        ×
      </button>
      <p className="tour-progress">Getting started</p>
      <h2>{step.title}</h2>
      <p>{step.text}</p>
      <div className="first-success-actions">
        <button type="button" className="link" onClick={onPause}>
          Skip tour
        </button>
        {!done(progress, "page-created") ? (
          <button type="button" className="primary small" onClick={onCreatePage}>
            New page
          </button>
        ) : basicComplete ? (
          <button type="button" className="primary small" onClick={onFinish}>
            Finish
          </button>
        ) : null}
      </div>
    </aside>
  );
}

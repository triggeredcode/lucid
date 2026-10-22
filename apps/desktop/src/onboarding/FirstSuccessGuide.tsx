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

const done = (progress: ActivationProgress, milestone: ActivationMilestone): boolean =>
  progress.milestones.includes(milestone);

function nextStep(progress: ActivationProgress): { title: string; text: string } {
  if (!done(progress, "page-created")) {
    return {
      title: "Create your first page",
      text: "Start with a real Lucid page. Your progress will continue there.",
    };
  }
  if (!done(progress, "content-added")) {
    return progress.provider === "ready"
      ? {
          title: "Add your first thought",
          text: "Stay in Input mode and type or speak a few sentences. Lucid will shape them into notes.",
        }
      : {
          title: "Add your first thought",
          text: "Choose Edit mode and type directly on the page. You can connect an AI provider later in Settings.",
        };
  }
  if (progress.provider === "ready" && !done(progress, "command-applied")) {
    return {
      title: "Make one change with AI",
      text: "Switch to Command mode and ask Lucid to revise, organize, or clarify something already on the page.",
    };
  }
  if (progress.provider === "ready" && !done(progress, "visual-created")) {
    return {
      title: "Build one visual",
      text: "Open Diagram or Table mode, create something useful, then choose Done to add it to the page.",
    };
  }
  if (!done(progress, "export-saved")) {
    return {
      title: "Take your work with you",
      text: "Export the page as Markdown or an editable .lucid note. PDF is available too when you need it.",
    };
  }
  return {
    title: hasAiFirstSuccess(progress)
      ? "You’ve completed the full Lucid flow"
      : "Your first page is ready",
    text: hasAiFirstSuccess(progress)
      ? "You created, shaped, visualized, and exported a real page."
      : "You created, edited, and exported a real page. Connect an AI provider whenever you want the full flow.",
  };
}

export function FirstSuccessGuide({ progress, onCreatePage, onPause, onFinish }: Props) {
  const step = nextStep(progress);
  const basicComplete = hasBasicFirstSuccess(progress);
  const checks: { milestone: ActivationMilestone; label: string; optional?: boolean }[] = [
    { milestone: "page-created", label: "Create a page" },
    { milestone: "content-added", label: "Add content" },
    ...(progress.provider === "ready"
      ? [
          { milestone: "command-applied" as const, label: "Use a command" },
          { milestone: "visual-created" as const, label: "Build a diagram or table" },
        ]
      : []),
    { milestone: "export-saved", label: "Save an export" },
  ];

  return (
    <aside className="first-success-guide" aria-label="First success guide">
      <div className="first-success-heading">
        <div>
          <span className="eyebrow">First success</span>
          <h2>{step.title}</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Skip for now" onClick={onPause}>
          ×
        </button>
      </div>
      <p>{step.text}</p>
      <ul className="first-success-checklist">
        {checks.map((item) => (
          <li key={item.milestone} data-done={done(progress, item.milestone)}>
            <span aria-hidden="true">{done(progress, item.milestone) ? "✓" : "○"}</span>
            {item.label}
          </li>
        ))}
      </ul>
      <div className="first-success-actions">
        <button type="button" className="link" onClick={onPause}>
          Skip for now
        </button>
        {!done(progress, "page-created") ? (
          <button type="button" className="primary small" onClick={onCreatePage}>
            Create my page
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

import { useEffect, useState } from "react";

interface Props {
  onFinish: () => void;
}

const STEPS = [
  {
    selector: '[data-tour="pages"]',
    title: "Your pages live here",
    text: "Create, import and switch between pages from this list.",
  },
  {
    selector: '[data-tour="modes"]',
    title: "Change how Lucid listens",
    text: "Input captures ideas. Command changes the page. Diagram and Table build things with you.",
  },
  {
    selector: '[data-tour="export"]',
    title: "Take the result with you",
    text: "Export the editable Lucid note, Markdown or a finished PDF.",
  },
] as const;

const CARD_HEIGHT = 210;
const CARD_GAP = 14;
const VIEWPORT_MARGIN = 20;

export function ProductTour({ onFinish }: Props) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect>();
  const current = STEPS[step] ?? STEPS[0];

  useEffect(() => {
    let frame = 0;
    let attempts = 0;
    const locate = () => {
      const target = document.querySelector<HTMLElement>(current.selector);
      if (!target && attempts++ < 30) {
        frame = requestAnimationFrame(locate);
        return;
      }
      if (!target) return;
      target.scrollIntoView({ block: "nearest" });
      setRect(target.getBoundingClientRect());
    };
    locate();
    const update = () => {
      locate();
    };
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
    };
  }, [current]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onFinish();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onFinish]);

  const next = () => {
    setRect(undefined);
    if (step === STEPS.length - 1) onFinish();
    else setStep((value) => value + 1);
  };
  const left = rect
    ? Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - 340))
    : VIEWPORT_MARGIN;
  const top = (() => {
    if (!rect) return VIEWPORT_MARGIN;
    if (rect.bottom + CARD_GAP + CARD_HEIGHT <= window.innerHeight - VIEWPORT_MARGIN) {
      return rect.bottom + CARD_GAP;
    }
    if (rect.top - CARD_GAP - CARD_HEIGHT >= VIEWPORT_MARGIN) {
      return rect.top - CARD_GAP - CARD_HEIGHT;
    }
    return Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.bottom + CARD_GAP, window.innerHeight - CARD_HEIGHT - VIEWPORT_MARGIN),
    );
  })();

  return (
    <div className="product-tour" role="dialog" aria-modal="true" aria-label="Lucid workspace tour">
      {rect && (
        <div
          className="tour-highlight"
          style={{
            left: rect.left - 5,
            top: rect.top - 5,
            width: rect.width + 10,
            height: rect.height + 10,
          }}
        />
      )}
      <div className="tour-card" style={{ left, top }}>
        <span className="tour-count">
          {step + 1} of {STEPS.length}
        </span>
        <h2>{current.title}</h2>
        <p>{current.text}</p>
        <div>
          <button type="button" className="link" onClick={onFinish}>
            End tour
          </button>
          <button type="button" className="primary small" onClick={next} autoFocus>
            {step === STEPS.length - 1 ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

import { setPageLook, useAppearance, type PageLookChoice } from "../theme/appearance";
import { Icon, type IconName } from "../ui/Icon";

/** What each choice is called, and its picture. */
export const PAGE_LOOKS: { value: PageLookChoice; label: string; icon: IconName }[] = [
  { value: "auto", label: "like the app", icon: "contrast" },
  { value: "light", label: "light", icon: "sun" },
  { value: "dark", label: "dark", icon: "moon" },
];

/**
 * The look of the page itself, apart from the app's own, as one small button in the top bar: it shows the page's look and a
 * click goes to the next (like the app, light, dark). Settings has the same choice as three buttons. "Like the app" follows the
 * app's light or dark; the others keep the page light (as paper) or dark whatever the app is.
 */
export function PageLookSwitch() {
  const { pageLook } = useAppearance();
  const at = Math.max(
    0,
    PAGE_LOOKS.findIndex((l) => l.value === pageLook),
  );
  const now = PAGE_LOOKS[at] ?? PAGE_LOOKS[0];
  const next = PAGE_LOOKS[(at + 1) % PAGE_LOOKS.length] ?? PAGE_LOOKS[0];
  if (!now || !next) return null;
  return (
    <button
      type="button"
      className="icon-button page-look"
      aria-label={`Look of the page: ${now.label}. Click for ${next.label}.`}
      title={`The page's own light or dark, apart from the app's: ${now.label}. Click for ${next.label}.`}
      onClick={() => {
        setPageLook(next.value);
      }}
    >
      <Icon name={now.icon} size={16} />
    </button>
  );
}

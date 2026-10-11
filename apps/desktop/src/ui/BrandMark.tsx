/** The mark of the app: a rounded square in the text colour with a cut-out L, in black and white like the rest. */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="20" height="20" rx="5" fill="currentColor" />
      <path
        d="M7 5v9h6.5"
        fill="none"
        stroke="var(--mark-cut, #fff)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

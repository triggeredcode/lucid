/**
 * A page as a small document: a sheet with a folded corner and two lines of text. It is the picture of a page in the list of
 * pages. Its size and line weight follow the app's other icons (16 px tall icons drawn with a line of about 1.1 px): the sheet
 * is 14 by 18 px, on the same 4 px grid as the rows around it. The open page is drawn filled. Colours come from the CSS
 * (`.file-glyph`).
 */
export function FileGlyph() {
  return (
    <svg
      className="file-glyph"
      width="14"
      height="18"
      viewBox="0 0 14 18"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="file-body"
        d="M2 .55h6.2l5.25 5.25V16a1.45 1.45 0 0 1-1.45 1.45H2A1.45 1.45 0 0 1 .55 16V2A1.45 1.45 0 0 1 2 .55Z"
      />
      <path className="file-fold" d="M8.2.55V4.4a1.4 1.4 0 0 0 1.4 1.4h3.85" />
      <path className="file-lines" d="M3.6 10h6.8M3.6 13h4.2" />
    </svg>
  );
}

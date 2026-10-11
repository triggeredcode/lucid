import type { NoteImportResult } from "../../electron/ipc/types";
import { Icon } from "../ui/Icon";

/** What an import did: each note that came in, and each file that could not be used, with the reason. */
export function ImportNotice({
  result,
  onClose,
}: {
  result: NoteImportResult;
  onClose: () => void;
}) {
  const { imported, problems } = result;
  return (
    <div
      className="banner import-notice"
      data-kind={problems.length > 0 ? "problem" : "ok"}
      role="status"
    >
      <div className="import-lines">
        {imported.map((n) => (
          <p key={n.id}>
            Imported <b>{n.title}</b>.
            {n.copy ? " You already had this note, so both are kept." : ""}
          </p>
        ))}
        {problems.map((p) => (
          <p key={`${p.fileName}-${p.message}`}>
            {p.fileName ? <b>{p.fileName}</b> : null}
            {p.fileName ? " could not be imported: " : "The import failed: "}
            {p.message} Nothing was changed.
          </p>
        ))}
        {imported.length === 0 && problems.length === 0 && <p>Nothing was imported.</p>}
      </div>
      <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
        <Icon name="x" />
      </button>
    </div>
  );
}

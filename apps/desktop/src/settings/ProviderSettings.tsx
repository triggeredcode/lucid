import { useEffect, useMemo, useRef, useState } from "react";
import {
  AI_PROVIDER_CATALOG,
  providerCredentialId,
  type AiProviderKind,
  type AiSettings,
  type CredentialStatus,
  type ProviderConnectionResult,
  type ProviderProfile,
} from "../../electron/ipc/types";

const modelHint = (kind: AiProviderKind): string => {
  if (kind === "lmstudio") return "qwen/qwen3.8-27b";
  if (kind === "ollama" || kind === "ollama-cloud") return "llama3.2";
  if (kind === "anthropic") return "claude-sonnet-4-5";
  if (kind === "openrouter") return "openai/gpt-4.1-mini";
  if (kind === "openai") return "gpt-4.1-mini";
  return "model-name";
};

const emptyCredential: CredentialStatus = {
  present: false,
  storage: "none",
  securePersistenceAvailable: true,
};

interface Props {
  value: AiSettings;
  lmStudioUrlLocked: boolean;
  onChange: (value: AiSettings) => void;
  onPersist: () => Promise<boolean>;
}

export function ProviderSettings({ value, lmStudioUrlLocked, onChange, onPersist }: Props) {
  const [activeId, setActiveId] = useState(value.defaultProfileId);
  const [addKind, setAddKind] = useState<AiProviderKind>("ollama");
  const [credential, setCredential] = useState<CredentialStatus>(emptyCredential);
  const [connection, setConnection] = useState<ProviderConnectionResult>();
  const [busy, setBusy] = useState<"key" | "test" | "models">();
  const [models, setModels] = useState<string[]>([]);
  const secret = useRef<HTMLInputElement>(null);
  const active =
    value.profiles.find((profile) => profile.id === activeId) ??
    value.profiles.find((profile) => profile.id === value.defaultProfileId) ??
    value.profiles[0];
  const provider = AI_PROVIDER_CATALOG.find((candidate) => candidate.kind === active?.kind);
  const credentialId = active ? providerCredentialId(active.id) : "";
  const modelListId = useMemo(() => `provider-models-${active?.id ?? "none"}`, [active?.id]);

  useEffect(() => {
    setConnection(undefined);
    setModels([]);
    if (!active) return;
    void window.lucid.credentials.status(providerCredentialId(active.id)).then(setCredential);
  }, [active?.id]);

  const replace = (change: Partial<ProviderProfile>) => {
    if (!active) return;
    onChange({
      ...value,
      profiles: value.profiles.map((profile) =>
        profile.id === active.id ? { ...profile, ...change } : profile,
      ),
    });
  };

  const add = () => {
    const definition = AI_PROVIDER_CATALOG.find((candidate) => candidate.kind === addKind);
    if (!definition) return;
    const id = `${addKind}-${crypto.randomUUID().slice(0, 8)}`;
    const profile: ProviderProfile = {
      id,
      name: definition.label,
      kind: addKind,
      baseUrl: definition.defaultBaseUrl,
      model: modelHint(addKind),
    };
    onChange({ ...value, profiles: [...value.profiles, profile] });
    setActiveId(id);
  };

  const remove = () => {
    if (!active || value.profiles.length === 1) return;
    const profiles = value.profiles.filter((profile) => profile.id !== active.id);
    const defaultProfileId =
      value.defaultProfileId === active.id ? (profiles[0]?.id ?? "") : value.defaultProfileId;
    onChange({ defaultProfileId, profiles });
    setActiveId(defaultProfileId);
    void window.lucid.credentials.delete(credentialId);
  };

  const saveKey = async () => {
    if (!active || !secret.current) return;
    const entered = secret.current.value;
    secret.current.value = "";
    if (!entered) return;
    setBusy("key");
    setConnection(undefined);
    try {
      setCredential(
        await window.lucid.credentials.save({
          id: credentialId,
          secret: entered,
          persist: true,
        }),
      );
    } catch {
      setConnection({
        ok: false,
        message: "The API key could not be saved. Check secure storage and try again.",
      });
    } finally {
      setBusy(undefined);
    }
  };

  const clearKey = async () => {
    setBusy("key");
    try {
      await window.lucid.credentials.delete(credentialId);
      setCredential(await window.lucid.credentials.status(credentialId));
    } catch {
      setConnection({
        ok: false,
        message: "The API key could not be removed. Check secure storage and try again.",
      });
    } finally {
      setBusy(undefined);
    }
  };

  const check = async (action: "test" | "models") => {
    if (!active || !(await onPersist())) return;
    setBusy(action);
    setConnection(undefined);
    try {
      const result =
        action === "test"
          ? await window.lucid.providers.test(active.id)
          : await window.lucid.providers.models(active.id);
      setConnection(result);
      if (result.ok && result.models) {
        setModels(result.models);
        if (!active.model && result.models[0]) replace({ model: result.models[0] });
      }
    } finally {
      setBusy(undefined);
    }
  };

  if (!active || !provider) return null;
  const baseUrlLocked = active.kind === "lmstudio" && lmStudioUrlLocked;

  return (
    <fieldset className="provider-settings">
      <legend>AI providers</legend>
      <p className="settings-intro">
        Choose where Lucid runs AI. Lucid never switches providers automatically.
      </p>
      <div className="provider-layout">
        <div className="provider-list" role="list" aria-label="Provider profiles">
          {value.profiles.map((profile) => {
            const definition = AI_PROVIDER_CATALOG.find(
              (candidate) => candidate.kind === profile.kind,
            );
            return (
              <button
                key={profile.id}
                type="button"
                role="listitem"
                aria-current={profile.id === active.id ? "true" : undefined}
                onClick={() => {
                  setActiveId(profile.id);
                }}
              >
                <span>{profile.name}</span>
                <small>
                  {definition?.label}
                  {profile.id === value.defaultProfileId ? " · default" : ""}
                </small>
              </button>
            );
          })}
          <div className="provider-add">
            <select
              aria-label="Provider to add"
              value={addKind}
              onChange={(event) => {
                setAddKind(event.target.value as AiProviderKind);
              }}
            >
              {AI_PROVIDER_CATALOG.map((item) => (
                <option key={item.kind} value={item.kind}>
                  {item.label}
                </option>
              ))}
            </select>
            <button type="button" className="ghost" onClick={add}>
              Add
            </button>
          </div>
        </div>

        <div className="provider-editor">
          <label>
            <span>Profile name</span>
            <input
              autoFocus
              value={active.name}
              onChange={(event) => {
                replace({ name: event.target.value });
              }}
            />
          </label>
          <label>
            <span>Base URL</span>
            <input
              value={active.baseUrl}
              disabled={!provider.customBaseUrl || baseUrlLocked}
              onChange={(event) => {
                replace({ baseUrl: event.target.value });
              }}
              spellCheck={false}
            />
            <small>
              {baseUrlLocked
                ? "Set by the LUCID_LLM_URL environment variable."
                : provider.customBaseUrl
                  ? "Cloud addresses must use HTTPS. Local HTTP is limited to this computer."
                  : `Fixed for ${provider.label}.`}
            </small>
          </label>
          <label>
            <span>Model</span>
            <input
              list={models.length > 0 ? modelListId : undefined}
              value={active.model}
              onChange={(event) => {
                replace({ model: event.target.value });
              }}
              spellCheck={false}
            />
            {models.length > 0 && (
              <datalist id={modelListId}>
                {models.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            )}
          </label>

          {provider.credential !== "none" && (
            <div className="provider-key">
              <label>
                <span>API key {provider.credential === "optional" ? "(optional)" : ""}</span>
                <input
                  ref={secret}
                  type="password"
                  autoComplete="off"
                  placeholder={credential.present ? "Key saved" : "Paste key"}
                  aria-describedby="provider-key-help"
                />
                <small id="provider-key-help">
                  {credential.present
                    ? credential.storage === "secure"
                      ? "Stored with this computer’s secure credential storage."
                      : "Kept for this session because secure storage is unavailable."
                    : "Sent directly to Lucid’s main process and cleared from this field."}
                </small>
              </label>
              <div className="provider-inline-actions">
                <button
                  type="button"
                  className="ghost"
                  disabled={busy === "key"}
                  onClick={() => void saveKey()}
                >
                  Save key
                </button>
                {credential.present && (
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy === "key"}
                    onClick={() => void clearKey()}
                  >
                    Remove key
                  </button>
                )}
              </div>
            </div>
          )}

          {provider.cloud && (
            <p className="provider-disclosure">
              Requests send the selected note context to {provider.label}. ChatGPT and Claude
              subscriptions do not include API access; API billing is separate.
            </p>
          )}

          <div className="provider-actions">
            <button
              type="button"
              className="ghost"
              disabled={busy !== undefined}
              onClick={() => void check("test")}
            >
              {busy === "test" ? "Testing…" : "Test connection"}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy !== undefined}
              onClick={() => void check("models")}
            >
              {busy === "models" ? "Fetching…" : "Fetch models"}
            </button>
            <button
              type="button"
              className="ghost"
              aria-pressed={active.id === value.defaultProfileId}
              onClick={() => {
                onChange({ ...value, defaultProfileId: active.id });
              }}
            >
              {active.id === value.defaultProfileId ? "Default provider" : "Set default"}
            </button>
            <button
              type="button"
              className="ghost danger"
              disabled={value.profiles.length === 1}
              onClick={remove}
            >
              Remove
            </button>
          </div>
          {connection && (
            <p
              className="provider-result"
              data-kind={connection.ok ? "success" : "error"}
              role="status"
            >
              {connection.message}
            </p>
          )}
        </div>
      </div>
    </fieldset>
  );
}

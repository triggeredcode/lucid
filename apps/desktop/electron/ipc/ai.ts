import { ipcMain, safeStorage } from "electron";
import { join } from "node:path";
import { CredentialVault, type SecretEncryption } from "../ai/credentials";
import { inspectProvider } from "../ai/providers";
import { createRuntimeResolver } from "../ai/runtime";
import { MainAiService, type AiRuntimeResolver } from "../ai/service";
import { loadSettings } from "../settings";
import {
  IPC,
  providerCredentialId,
  type AiEvent,
  type AiStartRequest,
  type CredentialSaveRequest,
  type ProviderConnectionResult,
} from "./types";

const encryption: SecretEncryption = {
  secureAvailable: () =>
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
  encrypt: (value) => safeStorage.encryptString(value),
  decrypt: (value) => safeStorage.decryptString(value),
};

export function registerSecureAiIpc(
  libraryDir: string,
  resolve?: AiRuntimeResolver,
): CredentialVault {
  const vault = new CredentialVault(join(libraryDir, ".lucid"), encryption);
  const service = new MainAiService(
    resolve ??
      createRuntimeResolver(libraryDir, fetch, process.env["LUCID_LLM_URL"], (id) =>
        vault.read(id),
      ),
  );
  ipcMain.handle(IPC.aiStart, async (event, request: AiStartRequest) =>
    service.start(request, (aiEvent: AiEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.aiEvent, aiEvent);
    }),
  );
  ipcMain.handle(IPC.aiAbort, (_event, id: unknown) => {
    if (typeof id === "number") service.abort(id);
  });
  ipcMain.handle(IPC.credentialSave, (_event, request: CredentialSaveRequest) =>
    vault.save(request.id, request.secret, request.persist),
  );
  ipcMain.handle(IPC.credentialDelete, (_event, id: string) => vault.delete(id));
  ipcMain.handle(IPC.credentialStatus, (_event, id: string) => vault.status(id));
  const inspect = async (id: unknown): Promise<ProviderConnectionResult> => {
    if (typeof id !== "string") return { ok: false, message: "Choose a provider profile first." };
    const profile = (await loadSettings(libraryDir)).ai.profiles.find(
      (candidate) => candidate.id === id,
    );
    if (!profile) return { ok: false, message: "That provider profile no longer exists." };
    const secret = await vault.read(providerCredentialId(profile.id));
    return inspectProvider(profile, secret);
  };
  ipcMain.handle(IPC.providerTest, (_event, id: unknown) => inspect(id));
  ipcMain.handle(IPC.providerModels, (_event, id: unknown) => inspect(id));
  return vault;
}

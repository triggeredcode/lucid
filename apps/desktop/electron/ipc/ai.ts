import { ipcMain, safeStorage } from "electron";
import { join } from "node:path";
import { CredentialVault, type SecretEncryption } from "../ai/credentials";
import { MainAiService, type AiRuntimeResolver } from "../ai/service";
import { IPC, type AiEvent, type AiStartRequest, type CredentialSaveRequest } from "./types";

const encryption: SecretEncryption = {
  secureAvailable: () =>
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
  encrypt: (value) => safeStorage.encryptString(value),
  decrypt: (value) => safeStorage.decryptString(value),
};

export function registerSecureAiIpc(
  libraryDir: string,
  resolve: AiRuntimeResolver = () => Promise.resolve(undefined),
): CredentialVault {
  const vault = new CredentialVault(join(libraryDir, ".lucid"), encryption);
  const service = new MainAiService(resolve);
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
  return vault;
}

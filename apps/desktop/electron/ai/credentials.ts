import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface SecretEncryption {
  secureAvailable(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

export type CredentialStorage = "secure" | "session";
export interface CredentialStatus {
  present: boolean;
  storage: CredentialStorage | "none";
  securePersistenceAvailable: boolean;
}

interface StoredSecrets {
  version: 1;
  secrets: Record<string, string>;
}

const credentialId = (value: string): string => {
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value)) throw new Error("invalid credential id");
  return value;
};
const without = (values: Record<string, string>, id: string): Record<string, string> =>
  Object.fromEntries(Object.entries(values).filter(([key]) => key !== id));

/** Main-process-only credentials. Disk values are encrypted bytes encoded as base64, never plaintext. */
export class CredentialVault {
  private readonly session = new Map<string, string>();
  private readonly file: string;

  constructor(
    directory: string,
    private readonly encryption: SecretEncryption,
  ) {
    this.file = join(directory, "credentials.json");
  }

  private async stored(): Promise<StoredSecrets> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Partial<StoredSecrets>;
      return parsed.version === 1 && parsed.secrets && typeof parsed.secrets === "object"
        ? { version: 1, secrets: { ...parsed.secrets } }
        : { version: 1, secrets: {} };
    } catch {
      return { version: 1, secrets: {} };
    }
  }

  private async write(stored: StoredSecrets): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${String(process.pid)}.tmp`;
    await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.file);
  }

  async save(idValue: string, secret: string, persist: boolean): Promise<CredentialStatus> {
    const id = credentialId(idValue);
    if (!secret || secret.length > 20_000) throw new Error("invalid credential");
    const stored = await this.stored();
    if (persist && this.encryption.secureAvailable()) {
      try {
        stored.secrets[id] = this.encryption.encrypt(secret).toString("base64");
        await this.write(stored);
        this.session.delete(id);
        return await this.status(id);
      } catch {
        // Temporary keychain failures fall through to memory. Never write the secret itself.
      }
    }
    if (id in stored.secrets) {
      stored.secrets = without(stored.secrets, id);
      await this.write(stored);
    }
    this.session.set(id, secret);
    return this.status(id);
  }

  /** Deliberately not exposed through preload or IPC. */
  async read(idValue: string): Promise<string | undefined> {
    const id = credentialId(idValue);
    const inSession = this.session.get(id);
    if (inSession !== undefined) return inSession;
    if (!this.encryption.secureAvailable()) return undefined;
    const encrypted = (await this.stored()).secrets[id];
    if (!encrypted) return undefined;
    return this.encryption.decrypt(Buffer.from(encrypted, "base64"));
  }

  async delete(idValue: string): Promise<void> {
    const id = credentialId(idValue);
    this.session.delete(id);
    const stored = await this.stored();
    if (id in stored.secrets) {
      stored.secrets = without(stored.secrets, id);
      await this.write(stored);
    }
  }

  async status(idValue: string): Promise<CredentialStatus> {
    const id = credentialId(idValue);
    const securePersistenceAvailable = this.encryption.secureAvailable();
    if (this.session.has(id))
      return { present: true, storage: "session", securePersistenceAvailable };
    const secure = securePersistenceAvailable && id in (await this.stored()).secrets;
    return { present: secure, storage: secure ? "secure" : "none", securePersistenceAvailable };
  }
}

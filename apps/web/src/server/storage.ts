import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface StoredObject {
  key: string;
  bytes: number;
  sha256: string;
}

/** Storage behind one small interface (ARCHITECTURE.md rule 1.8). Supabase/S3 adapter comes with the accounts. */
export interface FileStore {
  put(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<StoredObject>;
}

export class TooLargeError extends Error {}

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/;

/** Development store on local disk. Hashes while streaming so the hash is the server's, not the client's. */
export class LocalFileStore implements FileStore {
  constructor(private readonly root: string) {}

  async put(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<StoredObject> {
    if (!SAFE_KEY.test(key)) throw new RangeError("invalid key");
    await mkdir(this.root, { recursive: true });
    const final = path.join(this.root, key);
    const tmp = `${final}.part`;
    const hash = createHash("sha256");
    let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length;
        if (bytes > maxBytes) return cb(new TooLargeError(`exceeds ${maxBytes} bytes`));
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(body as never), meter, createWriteStream(tmp));
      await rename(tmp, final);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    return { key, bytes, sha256: hash.digest("hex") };
  }
}

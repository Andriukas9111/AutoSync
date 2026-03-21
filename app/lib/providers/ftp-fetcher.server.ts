// ---------------------------------------------------------------------------
// FTP Fetcher — downloads files from FTP servers
//
// Uses basic-ftp for FTP/FTPS connections.
// Ported from V1's working implementation (lib/providers/fetcher.ts).
// ---------------------------------------------------------------------------

import { Writable } from "node:stream";
import { Client as FtpClient } from "basic-ftp";

export type FtpProtocol = "ftp" | "sftp" | "ftps";

export interface FtpFetcherConfig {
  /** FTP host */
  host: string;
  /** Port (default: 21 for FTP, 990 for FTPS) */
  port?: number;
  /** Username */
  username: string;
  /** Password */
  password: string;
  /** Remote file path to download */
  remotePath: string;
  /** Protocol: ftp, ftps, or sftp */
  protocol: FtpProtocol;
}

export interface FtpFetchResult {
  /** Raw file content as string */
  content: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Filename from the remote path */
  filename: string;
}

export interface FtpFileInfo {
  name: string;
  size: number;
  isDirectory: boolean;
  modifiedAt?: Date;
}

/**
 * Fetch a file from an FTP server.
 *
 * Connects using basic-ftp, downloads the file at `remotePath` into a
 * memory buffer, and returns the content as UTF-8 text.
 */
export async function fetchFromFtp(
  config: FtpFetcherConfig,
): Promise<FtpFetchResult> {
  if (!config.host) {
    throw new Error("FTP host is required.");
  }
  if (!config.remotePath) {
    throw new Error("FTP remote path is required.");
  }

  if (config.protocol === "sftp") {
    throw new Error(
      "SFTP is not yet supported. Use FTP or FTPS instead.",
    );
  }

  const client = new FtpClient();
  client.ftp.verbose = false;

  try {
    const port = config.port || 21;

    await client.access({
      host: config.host,
      port,
      user: config.username || "anonymous",
      password: config.password || "",
      secure: config.protocol === "ftps" || port === 990,
    });

    // Download file into memory buffer
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });

    await client.downloadTo(writable, config.remotePath);
    const content = Buffer.concat(chunks).toString("utf-8");

    // Extract filename from path
    const pathParts = config.remotePath.split("/");
    const filename = pathParts[pathParts.length - 1] || "download";

    return {
      content,
      sizeBytes: Buffer.byteLength(content, "utf-8"),
      filename,
    };
  } finally {
    client.close();
  }
}

/**
 * Test an FTP connection by connecting and listing the directory.
 * Returns success/failure with a descriptive message.
 */
export async function testFtpConnection(
  config: FtpFetcherConfig,
): Promise<{ success: boolean; message?: string; error?: string; files?: FtpFileInfo[] }> {
  if (!config.host) {
    return { success: false, error: "FTP host is required." };
  }

  if (config.protocol === "sftp") {
    return { success: false, error: "SFTP is not yet supported. Use FTP or FTPS." };
  }

  const client = new FtpClient();
  client.ftp.verbose = false;

  try {
    const port = config.port || 21;

    await client.access({
      host: config.host,
      port,
      user: config.username || "anonymous",
      password: config.password || "",
      secure: config.protocol === "ftps" || port === 990,
    });

    // Try to list the directory at remotePath (or root)
    const dirPath = config.remotePath
      ? config.remotePath.replace(/\/[^/]+\.[^/]+$/, "") || "/"
      : "/";

    const fileList = await client.list(dirPath);
    const files: FtpFileInfo[] = fileList.map((f) => ({
      name: f.name,
      size: f.size,
      isDirectory: f.isDirectory,
      modifiedAt: f.modifiedAt,
    }));

    return {
      success: true,
      message: `Connected successfully. Found ${files.length} items in ${dirPath}`,
      files,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    return { success: false, error: message };
  } finally {
    client.close();
  }
}

// ---------------------------------------------------------------------------
// FTP / SFTP Fetcher — stub implementation
//
// FTP/SFTP requires native libraries (ssh2, basic-ftp) that may not work
// reliably in serverless environments (Vercel, Cloudflare Workers).
//
// TODO: Implement when moving to a long-running server or background worker.
//       Recommended libraries:
//       - FTP:  basic-ftp (https://www.npmjs.com/package/basic-ftp)
//       - SFTP: ssh2-sftp-client (https://www.npmjs.com/package/ssh2-sftp-client)
// ---------------------------------------------------------------------------

export type FtpProtocol = "ftp" | "sftp";

export interface FtpFetcherConfig {
  /** FTP/SFTP host */
  host: string;
  /** Port (defaults: FTP=21, SFTP=22) */
  port?: number;
  /** Username */
  username: string;
  /** Password */
  password: string;
  /** Remote file path to download */
  remotePath: string;
  /** Protocol: ftp or sftp */
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

/**
 * Fetch a file from an FTP/SFTP server.
 *
 * **Not yet implemented.** This is a stub that throws an error explaining
 * the limitation. FTP support will be added when a background worker
 * infrastructure is available.
 */
export async function fetchFromFtp(
  _config: FtpFetcherConfig,
): Promise<FtpFetchResult> {
  // TODO: Implement FTP/SFTP fetching
  //
  // Rough implementation plan:
  // 1. Install basic-ftp (for FTP) and ssh2-sftp-client (for SFTP)
  // 2. Connect using config credentials
  // 3. Download file to a buffer/stream
  // 4. Convert to string and return
  // 5. Close connection
  //
  // Example (basic-ftp):
  //   const client = new ftp.Client();
  //   await client.access({ host, port, user, password });
  //   const stream = await client.downloadTo(writableStream, remotePath);
  //   client.close();

  throw new Error(
    "FTP/SFTP fetching is not yet implemented. " +
      "This feature requires native libraries that are not available in serverless environments. " +
      "Please use CSV upload or API integration instead.",
  );
}

/**
 * Test an FTP/SFTP connection without downloading files.
 * Useful for validating credentials in the provider setup form.
 */
export async function testFtpConnection(
  _config: FtpFetcherConfig,
): Promise<{ success: boolean; error?: string }> {
  // TODO: Implement connection test
  return {
    success: false,
    error: "FTP/SFTP is not yet implemented. Please use CSV upload or API integration.",
  };
}

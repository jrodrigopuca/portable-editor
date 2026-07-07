/** Last path segment; enough for display and language detection on POSIX. */
export function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

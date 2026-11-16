export async function join(...parts: string[]): Promise<string> {
  return parts.join("/").replace(/\/{2,}/g, "/");
}

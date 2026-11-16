export function getCurrentWindow(): { setTheme: (theme: string) => Promise<void> } {
  return {
    setTheme: async () => {},
  };
}

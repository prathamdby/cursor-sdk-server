export function getTestBaseUrl(): string {
  const port = Number(Bun.env.PORT ?? 8765);
  return `http://127.0.0.1:${port}`;
}

export function assertOk(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

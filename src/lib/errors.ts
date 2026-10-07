/** Turns anything thrown (including Electron's wrapped IPC errors) into a message fit for a toast. */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const cleaned = raw.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '').trim();
  return cleaned || fallback;
}

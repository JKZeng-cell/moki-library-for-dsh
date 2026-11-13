export type TextContentSaveInput = {
  content: string;
  expectedVersion?: string;
  baseContent?: string;
};

export type TextContentSaveResult = {
  saved: true;
  version?: string;
  size: number;
  updatedAt: string;
  content?: string;
  reconciled?: boolean;
  unchanged?: boolean;
};

async function saveError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === 'string' && body.error ? body.error : fallback;
}

/** Keep previews usable while an installed update and the running host differ. */
export async function saveTextContent(
  fetchImpl: typeof fetch,
  url: string,
  input: TextContentSaveInput,
  fallback: string,
): Promise<TextContentSaveResult> {
  const put = (body: TextContentSaveInput) => fetchImpl(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let response = await put(input);
  if (response.ok) return response.json();
  let message = await saveError(response, fallback);

  // Hosts before 0.1.72 reject the new baseline field. Retry just that known
  // validation failure once, retaining the version guard on the source file.
  if (response.status === 400 && input.baseContent !== undefined && message === '文本保存参数无效') {
    response = await put({ content: input.content, expectedVersion: input.expectedVersion });
    if (response.ok) return response.json();
    message = await saveError(response, fallback);
  }

  if (response.status === 409) {
    // DSH may already have saved precisely this draft. Verify the latest bytes
    // before clearing its review; never retry with a newer or missing version.
    try {
      const current = await fetchImpl(url, { cache: 'no-store' });
      if (current.ok) {
        const latest = await current.json();
        if (latest.content === input.content && typeof latest.version === 'string'
          && /^[a-f0-9]{64}$/.test(latest.version) && typeof latest.size === 'number'
          && typeof latest.updatedAt === 'string') {
          return { saved: true, unchanged: true, version: latest.version, size: latest.size, updatedAt: latest.updatedAt };
        }
      }
    } catch { /* A failed verification must retain the draft and original error. */ }
  }
  throw new Error(message);
}

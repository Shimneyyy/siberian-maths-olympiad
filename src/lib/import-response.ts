// HTTP denials and stale previews are distinct from a response lost after commit.
export class ImportResponseError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ImportResponseError";
  }
}

export async function readImportResponse(response: Response, fallback: string) {
  let body;
  try {
    body = await response.json();
  } catch (error) {
    if (!response.ok) throw new ImportResponseError(response.status, fallback);
    throw error;
  }
  if (!response.ok) {
    throw new ImportResponseError(response.status, typeof body?.error === "string" ? body.error : fallback);
  }
  return body;
}

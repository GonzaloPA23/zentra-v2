export function downloadBlobResponse(response, fallbackName) {
  const disposition = response?.headers?.['content-disposition'] || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const fileName = match?.[1] || fallbackName;
  const url = URL.createObjectURL(response.data);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();

  URL.revokeObjectURL(url);
}

export async function getBlobErrorMessage(error, fallback = 'No se pudo completar la descarga') {
  const payload = error?.response?.data;

  if (payload instanceof Blob) {
    try {
      const rawText = await payload.text();
      if (!rawText) return fallback;

      try {
        const parsed = JSON.parse(rawText);
        return parsed?.mensaje
          || parsed?.errores?.[0]?.msg
          || fallback;
      } catch {
        return rawText;
      }
    } catch {
      return fallback;
    }
  }

  return error?.response?.data?.mensaje
    || error?.response?.data?.errores?.[0]?.msg
    || error?.message
    || fallback;
}

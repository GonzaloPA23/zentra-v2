function isExcelContentType(value = '') {
  const contentType = String(value).toLowerCase();
  return contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    || contentType.includes('application/octet-stream');
}

async function getInvalidDownloadMessage(blob) {
  try {
    const text = await blob.text();
    const trimmed = text.trim();

    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed?.mensaje || parsed?.errores?.[0]?.msg || null;
    } catch {
      if (/<!doctype html|<html/i.test(trimmed)) {
        return 'El servidor devolvio la pagina de Zentra en lugar del archivo Excel. Recarga la pagina e intenta nuevamente.';
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function downloadBlobResponse(response, fallbackName) {
  const disposition = response?.headers?.['content-disposition'] || '';
  const headerContentType = response?.headers?.['content-type'] || '';
  const blob = response?.data;

  if (!(blob instanceof Blob)) {
    throw new Error('El servidor no devolvio un archivo descargable');
  }

  const contentType = headerContentType || blob.type || '';
  if (!isExcelContentType(contentType)) {
    const message = await getInvalidDownloadMessage(blob);
    throw new Error(message || 'El servidor no devolvio un archivo Excel valido');
  }

  const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const isZipFile = signature.length === 4
    && signature[0] === 0x50
    && signature[1] === 0x4b
    && signature[2] === 0x03
    && signature[3] === 0x04;
  if (!isZipFile) {
    const message = await getInvalidDownloadMessage(blob);
    throw new Error(message || 'El archivo Excel recibido no es valido');
  }

  const match = disposition.match(/filename="?([^"]+)"?/i);
  const fileName = match?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Algunos navegadores necesitan que la URL siga viva mientras inician
  // la descarga. Revocarla inmediatamente puede cancelar el archivo.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

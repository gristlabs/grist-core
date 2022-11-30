import {drive} from '@googleapis/drive';
import {Readable} from 'form-data';
import {GaxiosError, GaxiosPromise} from 'gaxios';
import {FetchError, Response as FetchResponse, Headers} from 'node-fetch';
import {getGoogleAuth} from "app/server/lib/GoogleAuth";
import contentDisposition from 'content-disposition';

const
  SPREADSHEETS_MIMETYPE = 'application/vnd.google-apps.spreadsheet',
  XLSX_MIMETYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function downloadFromGDrive(url: string, code?: string) {
  const fileId = fileIdFromUrl(url);
  const key = process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error("Can't download file from Google Drive. Api key is not configured");
  }
  if (!fileId) {
    throw new Error(`Can't download from ${url}. Url is not valid`);
  }
  const googleDrive = await initDriveApi(code);
  const fileRes = await googleDrive.files.get({
    key,
    fileId
  });
  if (fileRes.data.mimeType === SPREADSHEETS_MIMETYPE) {
    let filename = fileRes.data.name;
    if (filename && !filename.includes(".")) {
      filename = `${filename}.xlsx`;
    }
    return await asFetchResponse(googleDrive.files.export(
      {key, fileId, alt: 'media', mimeType: XLSX_MIMETYPE},
      {responseType: 'stream'}
    ), filename);
  } else {
    return await asFetchResponse(googleDrive.files.get(
      {key, fileId, alt: 'media'},
      {responseType: 'stream'}
    ), fileRes.data.name);
  }
}

async function initDriveApi(code?: string) {
  if (code) {
    // Create drive with access token.
    const auth = getGoogleAuth();
    const token = await auth.getToken(code);
    if (token.tokens) {
      auth.setCredentials(token.tokens);
    }
    return drive({version: 'v3', auth: code ? auth : undefined});
  }
  // Create drive for public access.
  return drive({version: 'v3'});
}

async function asFetchResponse(req: GaxiosPromise<Readable>, filename?: string | null) {
  try {
    const res = await req;
    const headers = new Headers(res.headers);
    if (filename) {
      headers.set("content-disposition", contentDisposition(filename));
    }
    return new FetchResponse(res.data, {
      headers,
      status: res.status,
      statusText: res.statusText
    });
  } catch (err) {
    const error: GaxiosError<Readable> = err;
    if (!error.response) {
      // Fetch throws exception on network error.
      // https://github.com/node-fetch/node-fetch/blob/master/docs/ERROR-HANDLING.md
      throw new FetchError(error.message, "system", error);
    } else {
      // Fetch returns failure response on http error
      const resInit = error.response ? {
        status: error.response.status,
        headers: new Headers(error.response.headers),
        statusText: error.response.statusText
      } : undefined;
      return new FetchResponse(error.response.data, resInit);
    }
  }
}

export function isDriveUrl(url: string) {
  return !!fileIdFromUrl(url);
}

function fileIdFromUrl(url: string) {
  if (!url) { return null; }
  const match = /^https:\/\/(docs|drive).google.com\/(spreadsheets|file)\/d\/([^/?]*)/i.exec(url);
  return match ? match[3] : null;
}

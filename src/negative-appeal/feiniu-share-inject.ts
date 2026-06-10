/**
 * MAIN：Hook 飞牛分享页 API；下载须走页面签名层，并缓存用户/页面触发的成功下载。
 */
(function feiniuShareInjectMain(): void {
  const g = globalThis as typeof globalThis & { __DTX_FN_SHARE_INJECT__?: boolean };
  if (g.__DTX_FN_SHARE_INJECT__) return;
  g.__DTX_FN_SHARE_INJECT__ = true;

  const shareIdMatch = location.pathname.match(/\/s\/([a-z0-9]+)/i);
  const shareId = shareIdMatch?.[1] ?? '';
  const apiBase = `${location.origin}/s/${shareId}`;

  type FnFile = { path: string; fileId: number; fileName: string };
  type AuthSnap = { auth?: string; authx?: string };
  type CachedImg = { mime: string; dataBase64: string; via: string };

  const files: FnFile[] = [];
  const authSnap: AuthSnap = {};
  const downloadCache = new Map<string, CachedImg>();
  let lastListAt = 0;

  const IMG_EXT_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;
  const MIN_BYTES = 48_000;

  const bareFetch = globalThis.fetch.bind(globalThis);
  let pageSignedFetch: typeof fetch = bareFetch;

  function refreshPageSignedFetch(): void {
    const f = globalThis.fetch;
    if (f !== dtxFetchWrapper) pageSignedFetch = f.bind(globalThis);
  }

  function captureAuth(headers: HeadersInit | undefined): void {
    if (!headers) return;
    const h = new Headers(headers);
    const auth = h.get('auth');
    const authx = h.get('authx');
    if (auth) authSnap.auth = auth;
    if (authx) authSnap.authx = authx;
  }

  function cacheImage(fileName: string, packed: CachedImg): void {
    if (!fileName) return;
    downloadCache.set(fileName, packed);
  }

  function entryFromListItem(o: Record<string, unknown>): FnFile | null {
    if (o.isDir === 1 || o.isDir === true) return null;
    const fileId = Number(o.fileId ?? o.id);
    if (!Number.isFinite(fileId)) return null;

    const dirPath = typeof o.path === 'string' ? o.path.trim() : '';
    const fileName =
      (typeof o.file === 'string' ? o.file.trim() : '') ||
      (typeof o.fileName === 'string' ? o.fileName.trim() : '') ||
      (typeof o.name === 'string' ? o.name.trim() : '');

    let fullPath = dirPath;
    if (fileName) {
      fullPath = dirPath
        ? dirPath.endsWith('/')
          ? `${dirPath}${fileName}`
          : `${dirPath}/${fileName}`
        : fileName;
    }
    if (!fullPath || !IMG_EXT_RE.test(fullPath)) return null;
    const baseName = fileName || fullPath.split('/').pop() || fullPath;
    return { path: fullPath, fileId, fileName: baseName };
  }

  function mergeFile(entry: FnFile | null): void {
    if (!entry) return;
    const key = `${entry.fileId}:${entry.path}`;
    if (!files.some((f) => `${f.fileId}:${f.path}` === key)) {
      files.push(entry);
      lastListAt = Date.now();
    }
  }

  function ingestListJson(text: string): void {
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const data = json.data;
      if (data && typeof data === 'object') {
        const list = (data as Record<string, unknown>).files;
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && typeof item === 'object') mergeFile(entryFromListItem(item as Record<string, unknown>));
          }
        }
      }
      extractFiles(json);
    } catch {
      /* ignore */
    }
  }

  function tryStoreList(text: string, url: string): void {
    if (!text || !/\/api\/v1\/share/i.test(url)) return;
    if (!/list|files|dir|browse|download|preview|thumb/i.test(url) && !text.includes('"files"')) return;
    if (!text.trim().startsWith('{') && !text.trim().startsWith('[')) return;
    ingestListJson(text);
  }

  function extractFiles(node: unknown, depth = 0): void {
    if (depth > 14 || node == null) return;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 500)) extractFiles(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    mergeFile(entryFromListItem(o));
    const pathOnly = typeof o.path === 'string' ? o.path : '';
    if (pathOnly && IMG_EXT_RE.test(pathOnly) && !o.file) {
      const fid = o.fileId ?? o.id;
      if (fid != null) {
        mergeFile({
          path: pathOnly,
          fileId: Number(fid),
          fileName: pathOnly.split('/').pop() || pathOnly,
        });
      }
    }
    if (o.data && typeof o.data === 'object') extractFiles(o.data, depth + 1);
    if (Array.isArray(o.files)) extractFiles(o.files, depth + 1);
    for (const v of Object.values(o).slice(0, 80)) {
      if (v === o.data || v === o.files) continue;
      extractFiles(v, depth + 1);
    }
  }

  function parseDownloadFilenames(body: unknown): string[] {
    if (!body) return [];
    try {
      const raw = typeof body === 'string' ? body : '';
      if (!raw.trim().startsWith('{')) return [];
      const json = JSON.parse(raw) as { files?: { path?: string }[]; downloadFilename?: string };
      if (Array.isArray(json.files) && json.files.length === 0) return [];
      const names: string[] = [];
      if (json.downloadFilename) names.push(json.downloadFilename);
      for (const f of json.files ?? []) {
        const p = f.path ?? '';
        const n = p.split('/').pop();
        if (n) names.push(n);
      }
      return names;
    } catch {
      return [];
    }
  }

  function isDownloadAllBody(body: unknown): boolean {
    if (typeof body !== 'string') return false;
    return /"files"\s*:\s*\[\s*\]/.test(body) && /飞牛分享文件/.test(body);
  }

  async function blobToB64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = String(r.result ?? '');
        const i = s.indexOf('base64,');
        resolve(i >= 0 ? s.slice(i + 7) : s);
      };
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function resolveShareUrl(pathOrUrl: string): string {
    const p = pathOrUrl.trim();
    if (/^https?:\/\//i.test(p)) return p;
    if (p.startsWith('/')) return `${location.origin}${p}`;
    return `${location.origin}/${p}`;
  }

  function extractDownloadHref(json: Record<string, unknown>): string | null {
    const data = (json.data ?? json) as Record<string, unknown>;
    return (
      (typeof data.path === 'string' ? data.path : null) ??
      (typeof data.url === 'string' ? data.url : null) ??
      (typeof data.downloadUrl === 'string' ? data.downloadUrl : null) ??
      (typeof json.url === 'string' ? json.url : null)
    );
  }

  async function fetchBlobAsCached(url: string, via: string, fileName: string): Promise<CachedImg | null> {
    try {
      const full = resolveShareUrl(url);
      // token 下载链（/s/download/...?token=）只需 Cookie，不必 authx
      const fetchFn = /\/s\/download\//i.test(full) ? bareFetch : pageSignedFetch;
      const res = await fetchFn(full, {
        credentials: 'include',
        headers: /\/s\/download\//i.test(full) ? { Referer: `${apiBase}/` } : undefined,
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob.size || blob.size < MIN_BYTES) return null;
      const mime = blob.type || 'image/png';
      if (!/^image\//i.test(mime) && !IMG_EXT_RE.test(fileName)) return null;
      return { mime: mime.startsWith('image/') ? mime : 'image/png', dataBase64: await blobToB64(blob), via };
    } catch {
      return null;
    }
  }

  const BATCH_ZIP_KEY = '__BATCH_ZIP__';

  async function cacheFromDownloadJson(
    json: Record<string, unknown>,
    fileNames: string[],
  ): Promise<void> {
    if (json.code !== 0 && json.code !== undefined) return;
    const href = extractDownloadHref(json);
    if (!href) return;

    const full = resolveShareUrl(href);
    try {
      const res = await bareFetch(full, {
        credentials: 'include',
        headers: { Referer: `${apiBase}/` },
      });
      if (!res.ok) return;
      const ct = res.headers.get('content-type') || '';
      const blob = await res.blob();
      if (!blob.size) return;

      const isZip =
        /zip/i.test(ct) ||
        /\.zip(\?|$)/i.test(href) ||
        fileNames.length === 0 ||
        fileNames.length > 1;

      if (isZip) {
        downloadCache.set(BATCH_ZIP_KEY, {
          mime: 'application/zip',
          dataBase64: await blobToB64(blob),
          via: 'download-token-zip',
        });
        window.dispatchEvent(new Event('dtx-fn-batch-zip-ready'));
        return;
      }

      if (blob.size < MIN_BYTES) return;
      const packed: CachedImg = {
        mime: blob.type || 'image/png',
        dataBase64: await blobToB64(blob),
        via: 'download-token',
      };
      if (fileNames.length > 1) {
        for (const name of fileNames) cacheImage(name, packed);
      } else {
        cacheImage(fileNames[0] ?? '', packed);
      }
    } catch {
      /* ignore */
    }
  }

  async function sniffDownloadResponse(url: string, text: string, body: unknown): Promise<void> {
    if (!/\/download/i.test(url) || !text.trim().startsWith('{')) return;
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const names = parseDownloadFilenames(body);
      await cacheFromDownloadJson(json, names);
    } catch {
      /* ignore */
    }
  }

  async function sniffImageGet(url: string, blob: Blob): Promise<void> {
    if (!blob.size || blob.size < MIN_BYTES || !/^image\//i.test(blob.type)) return;
    const u = new URL(url, location.origin);
    const fileParam = u.searchParams.get('file') ?? u.searchParams.get('path') ?? '';
    const name = fileParam.split('/').pop() || '';
    if (!name || !IMG_EXT_RE.test(name)) return;
    cacheImage(name, {
      mime: blob.type,
      dataBase64: await blobToB64(blob),
      via: 'get-file-url',
    });
  }

  /** 代发 API：走 pageSignedFetch（飞牛前端签名层），不能 bareFetch */
  async function signedApiFetch(url: string, body: string): Promise<Response> {
    refreshPageSignedFetch();
    const fetchFn = pageSignedFetch === dtxFetchWrapper ? bareFetch : pageSignedFetch;
    return fetchFn(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
      },
      body,
    });
  }

  async function dtxFetchWrapper(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (input instanceof Request) captureAuth(input.headers);
    captureAuth(init?.headers);

    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const reqBody = init?.body;

    refreshPageSignedFetch();
    const fetchFn = pageSignedFetch === dtxFetchWrapper ? bareFetch : pageSignedFetch;
    const res = await fetchFn(input, init);

    try {
      const clone = res.clone();
      if (/\/download/i.test(url)) {
        const text = await clone.text();
        await sniffDownloadResponse(url, text, reqBody);
      } else {
        void clone.text().then((t) => tryStoreList(t, url));
      }
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (/^image\//i.test(ct) || /\/s\/download\//i.test(url)) {
          void res
            .clone()
            .blob()
            .then((b) => sniffImageGet(url, b));
        }
      }
    } catch {
      /* ignore */
    }
    return res;
  }

  globalThis.fetch = dtxFetchWrapper;

  const XHR = globalThis.XMLHttpRequest;
  if (XHR?.prototype) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    const setRequestHeader = XHR.prototype.setRequestHeader;

    XHR.prototype.open = function dtxFnOpen(method: string, url: string | URL, ...rest: unknown[]) {
      (this as XMLHttpRequest & { __dtxUrl?: string }).__dtxUrl = String(url);
      (this as XMLHttpRequest & { __dtxHdrs?: Record<string, string> }).__dtxHdrs = {};
      return open.apply(this, [method, url, ...rest] as Parameters<typeof open>);
    };
    XHR.prototype.setRequestHeader = function dtxFnSetHeader(name: string, value: string) {
      const box = (this as XMLHttpRequest & { __dtxHdrs?: Record<string, string> }).__dtxHdrs;
      if (box) box[name.toLowerCase()] = value;
      captureAuth(box);
      return setRequestHeader.call(this, name, value);
    };
    XHR.prototype.send = function dtxFnSend(body?: Document | XMLHttpRequestBodyInit | null) {
      const box = (this as XMLHttpRequest & { __dtxHdrs?: Record<string, string> }).__dtxHdrs;
      const url = (this as XMLHttpRequest & { __dtxUrl?: string }).__dtxUrl ?? '';
      captureAuth(box);
      this.addEventListener('load', () => {
        void (async () => {
          try {
            if (typeof this.responseText === 'string') {
              if (/\/download/i.test(url)) {
                await sniffDownloadResponse(url, this.responseText, body);
              } else {
                tryStoreList(this.responseText, url);
              }
            }
          } catch {
            /* ignore */
          }
        })();
      });
      return send.call(this, body);
    };
  }

  window.addEventListener('load', refreshPageSignedFetch);
  window.setInterval(refreshPageSignedFetch, 800);

  function findRowByFileName(fileName: string): Element | null {
    for (const row of document.querySelectorAll('tr, li, [role="row"]')) {
      for (const el of row.querySelectorAll('td, span, div, a, p')) {
        const t = (el.textContent || '').trim();
        if (t === fileName) return row;
      }
    }
    for (const row of document.querySelectorAll('tr, li, [role="row"]')) {
      if (row.textContent?.includes(fileName)) return row;
    }
    return null;
  }

  async function tryDirectFileGet(file: FnFile): Promise<CachedImg | null> {
    const encPath = encodeURIComponent(file.path);
    const encName = encodeURIComponent(file.fileName);
    const urls = [
      `${apiBase}?file=${encPath}`,
      `${apiBase}?path=${encPath}`,
      `${apiBase}?file=${encName}`,
      `${apiBase}/api/v1/share/file?shareId=${shareId}&path=${encPath}`,
      `${apiBase}/api/v1/share/preview?shareId=${shareId}&path=${encPath}`,
    ];
    for (const url of urls) {
      const packed = await fetchBlobAsCached(url, 'direct-get', file.fileName);
      if (packed) return packed;
    }
    return null;
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** 飞牛在拿到 token 后会触发浏览器另存为；扩展已用 fetch 拉原图，需拦截导航 */
  let suppressSaveDialogDepth = 0;
  let savedOpen: typeof window.open | null = null;
  let savedAnchorClick: typeof HTMLAnchorElement.prototype.click | null = null;
  let savedHrefSet: ((v: string) => void) | null = null;
  let savedLocationReplace: ((url: string | URL) => void) | null = null;

  function isBrowserDownloadNav(url: string): boolean {
    return /\/s\/download\//i.test(url);
  }

  function installSaveDialogSuppress(): () => void {
    suppressSaveDialogDepth += 1;
    if (suppressSaveDialogDepth > 1) {
      return () => {
        suppressSaveDialogDepth = Math.max(0, suppressSaveDialogDepth - 1);
      };
    }

    savedOpen = window.open;
    window.open = ((url?: string | URL, ...rest: unknown[]) => {
      if (suppressSaveDialogDepth > 0 && isBrowserDownloadNav(String(url ?? ''))) {
        return null;
      }
      return savedOpen!.apply(window, [url as string, ...rest] as Parameters<typeof window.open>);
    }) as typeof window.open;

    savedAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function dtxSuppressAnchorClick(
      this: HTMLAnchorElement,
      ...args: []
    ) {
      const href = this.href || this.getAttribute('href') || '';
      if (suppressSaveDialogDepth > 0 && isBrowserDownloadNav(href)) {
        return;
      }
      return savedAnchorClick!.apply(this, args);
    };

    // 现代浏览器 location.assign 只读，不能覆盖；用 href / replace 拦截即可
    try {
      const assignDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'assign');
      if (assignDesc?.writable && assignDesc.value) {
        const nativeAssign = assignDesc.value as (url: string | URL) => void;
        Object.defineProperty(Location.prototype, 'assign', {
          configurable: true,
          writable: true,
          value(url: string | URL) {
            if (suppressSaveDialogDepth > 0 && isBrowserDownloadNav(String(url))) return;
            nativeAssign.call(this, url);
          },
        });
      }
    } catch {
      /* 只读环境跳过 */
    }

    try {
      const replaceDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'replace');
      if (replaceDesc?.writable && replaceDesc.value) {
        savedLocationReplace = replaceDesc.value.bind(location);
        Object.defineProperty(Location.prototype, 'replace', {
          configurable: true,
          writable: true,
          value(url: string | URL) {
            if (suppressSaveDialogDepth > 0 && isBrowserDownloadNav(String(url))) return;
            savedLocationReplace!(url);
          },
        });
      }
    } catch {
      /* ignore */
    }

    const hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    if (hrefDesc?.set) {
      savedHrefSet = hrefDesc.set;
      Object.defineProperty(Location.prototype, 'href', {
        configurable: true,
        enumerable: hrefDesc.enumerable,
        get: hrefDesc.get,
        set(v: string) {
          if (suppressSaveDialogDepth > 0 && isBrowserDownloadNav(v)) {
            return;
          }
          savedHrefSet!.call(this, v);
        },
      });
    }

    return () => {
      suppressSaveDialogDepth = Math.max(0, suppressSaveDialogDepth - 1);
      if (suppressSaveDialogDepth > 0) return;
      if (savedOpen) window.open = savedOpen;
      if (savedAnchorClick) HTMLAnchorElement.prototype.click = savedAnchorClick;
      if (savedHrefSet && hrefDesc) {
        Object.defineProperty(Location.prototype, 'href', {
          configurable: true,
          enumerable: hrefDesc.enumerable,
          get: hrefDesc.get,
          set: savedHrefSet,
        });
      }
      savedOpen = null;
      savedAnchorClick = null;
      savedHrefSet = null;
      savedLocationReplace = null;
    };
  }

  function cachedImagesRecord(fileList: FnFile[]): Record<string, { mime: string; dataBase64: string }> {
    const images: Record<string, { mime: string; dataBase64: string }> = {};
    for (const f of fileList) {
      const c = downloadCache.get(f.fileName);
      if (c?.dataBase64) images[f.fileName] = { mime: c.mime, dataBase64: c.dataBase64 };
    }
    return images;
  }

  async function downloadOneViaApi(file: FnFile): Promise<CachedImg | null> {
    const cached = downloadCache.get(file.fileName);
    if (cached) return cached;

    const body = JSON.stringify({
      files: [{ path: file.path, fileId: file.fileId }],
      shareId,
      downloadFilename: file.fileName,
    });

    try {
      const res = await signedApiFetch(`${apiBase}/api/v1/share/download`, body);
      const text = await res.text();
      if (text.trim().startsWith('{')) {
        const json = JSON.parse(text) as Record<string, unknown>;
        if (json.code !== 0 && json.code !== undefined) return null;
        await cacheFromDownloadJson(json, [file.fileName]);
      }
      return downloadCache.get(file.fileName) ?? null;
    } catch {
      return null;
    }
  }

  async function downloadFilesParallelApi(fileList: FnFile[], concurrency = 8): Promise<number> {
    if (!fileList.length) return 0;
    let next = 0;
    const runOne = async (): Promise<void> => {
      while (next < fileList.length) {
        const i = next++;
        const f = fileList[i];
        if (downloadCache.get(f.fileName)?.dataBase64) continue;
        await downloadOneViaApi(f);
      }
    };
    const n = Math.min(concurrency, fileList.length);
    await Promise.all(Array.from({ length: n }, () => runOne()));
    return Object.keys(cachedImagesRecord(fileList)).length;
  }

  function clearFileSelections(): void {
    for (const cb of document.querySelectorAll('input[type="checkbox"]:checked')) {
      (cb as HTMLInputElement).click();
    }
  }

  function selectFileRow(fileName: string): boolean {
    const row = findRowByFileName(fileName);
    if (!row) return false;
    (row as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'instant' });
    const cb = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    if (cb) {
      if (!cb.checked) cb.click();
      return true;
    }
    (row as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }

  function selectAllFileRows(): void {
    const head = document.querySelector('thead input[type="checkbox"]') as HTMLInputElement | null;
    if (head && !head.checked) head.click();
    for (const cb of document.querySelectorAll('tbody input[type="checkbox"], tr input[type="checkbox"]')) {
      if (!(cb as HTMLInputElement).checked) (cb as HTMLInputElement).click();
    }
  }

  function clickToolbarDownloadAll(): boolean {
    const btn = [...document.querySelectorAll('button, a, span, [role="button"]')].find(
      (el) => (el.textContent || '').trim() === '下载全部',
    );
    if (!btn) return false;
    const node = btn as HTMLElement;
    if (node.disabled || node.getAttribute('aria-disabled') === 'true') return false;
    node.click();
    return true;
  }

  /** 只点列表上方工具栏「下载」，避免点到表格行里的其它按钮 */
  function clickToolbarDownload(): boolean {
    const allBtn = [...document.querySelectorAll('button, a, span, [role="button"]')].find(
      (el) => (el.textContent || '').trim() === '下载全部',
    );
    if (allBtn?.parentElement) {
      for (const el of allBtn.parentElement.querySelectorAll('button, a, span, [role="button"]')) {
        const t = (el.textContent || '').trim();
        if (t !== '下载') continue;
        const node = el as HTMLElement;
        if (node.disabled || node.getAttribute('aria-disabled') === 'true') continue;
        node.click();
        return true;
      }
    }
    for (const el of document.querySelectorAll('button, a, [role="button"]')) {
      const t = (el.textContent || '').trim();
      if (t !== '下载' || t.includes('全部')) continue;
      const node = el as HTMLElement;
      if (node.closest('tr, [role="row"]')) continue;
      if (node.disabled || node.getAttribute('aria-disabled') === 'true') continue;
      node.click();
      return true;
    }
    return false;
  }

  /** 模拟用户：勾选 → 点「下载」拿签名；拦截 token 链接触发的另存为，原图由扩展 fetch */
  async function uiDownloadFile(file: FnFile, attempt = 1): Promise<CachedImg | null> {
    const unhook = installSaveDialogSuppress();
    try {
      clearFileSelections();
      await sleep(attempt === 1 ? 200 : 400);
      if (!selectFileRow(file.fileName)) return null;
      await sleep(500);
      if (!clickToolbarDownload()) return null;
      const hit = await waitDownloadCache(file.fileName, 12000);
      if (hit) return hit;
      if (attempt < 2) {
        await sleep(400);
        return uiDownloadFile(file, attempt + 1);
      }
      return null;
    } finally {
      unhook();
    }
  }

  function waitDownloadCache(fileName: string, ms: number): Promise<CachedImg | null> {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const hit = downloadCache.get(fileName);
        if (hit) {
          resolve(hit);
          return;
        }
        if (Date.now() - start >= ms) {
          resolve(null);
          return;
        }
        window.setTimeout(tick, 200);
      };
      tick();
    });
  }

  function waitBatchZipReady(ms: number): Promise<CachedImg | null> {
    const existing = downloadCache.get(BATCH_ZIP_KEY);
    if (existing?.dataBase64) return Promise.resolve(existing);

    return new Promise((resolve) => {
      const done = () => {
        cleanup();
        resolve(downloadCache.get(BATCH_ZIP_KEY) ?? null);
      };
      const onZip = () => done();
      const cleanup = () => {
        window.removeEventListener('dtx-fn-batch-zip-ready', onZip);
        window.clearTimeout(timer);
      };
      window.addEventListener('dtx-fn-batch-zip-ready', onZip, { once: true });
      const timer = window.setTimeout(done, ms);
    });
  }

  function buildDownloadAllBody(): string {
    return JSON.stringify({
      files: [],
      shareId,
      downloadFilename: '飞牛分享文件',
    });
  }

  async function downloadAllBatch(
    fileList: FnFile[],
    _folderPath: string,
  ): Promise<{ ok: boolean; images?: Record<string, { mime: string; dataBase64: string }>; zipBase64?: string; via?: string; error?: string }> {
    const cached = downloadCache.get(BATCH_ZIP_KEY);
    if (cached?.dataBase64) {
      return { ok: true, zipBase64: cached.dataBase64, via: `${cached.via || 'zip'}-cache` };
    }

    refreshPageSignedFetch();
    downloadCache.delete(BATCH_ZIP_KEY);

    // 1) API「下载全部」→ ZIP（最快，无需 UI）
    try {
      const res = await signedApiFetch(`${apiBase}/api/v1/share/download`, buildDownloadAllBody());
      const text = await res.text();
      if (text.trim().startsWith('{')) {
        const json = JSON.parse(text) as Record<string, unknown>;
        if (json.code === 0 || json.code === undefined) {
          await cacheFromDownloadJson(json, []);
        }
      }
      const apiZip = downloadCache.get(BATCH_ZIP_KEY);
      if (apiZip?.dataBase64) {
        return { ok: true, zipBase64: apiZip.dataBase64, via: apiZip.via || 'api-download-all' };
      }
    } catch {
      /* 并行单张 */
    }

    // 2) 并行 API 单张（适合大量图，不点 UI）
    const got = await downloadFilesParallelApi(fileList, 8);
    if (got >= fileList.length) {
      return { ok: true, images: cachedImagesRecord(fileList), via: 'api-parallel' };
    }

    // 3) UI「下载全部」→ ZIP（需拦截另存为）
    const unhook = installSaveDialogSuppress();
    try {
      clearFileSelections();
      await sleep(120);
      if (clickToolbarDownloadAll()) {
        const zip = await waitBatchZipReady(35000);
        if (zip?.dataBase64) {
          return { ok: true, zipBase64: zip.dataBase64, via: zip.via || 'ui-download-all' };
        }
      }
    } finally {
      unhook();
    }

    const images = cachedImagesRecord(fileList);
    if (Object.keys(images).length > 0) {
      return {
        ok: Object.keys(images).length >= fileList.length,
        images,
        via: 'api-parallel-partial',
        error:
          Object.keys(images).length < fileList.length
            ? `仅获取 ${Object.keys(images).length}/${fileList.length} 张`
            : undefined,
      };
    }

    if (!authSnap.auth) {
      return {
        ok: false,
        error: '未捕获下载签名。请刷新分享页，等文件列表出现后再同步',
      };
    }
    return { ok: false, error: '批量与并行下载均未成功，请刷新页面后重试' };
  }

  async function downloadOne(file: FnFile): Promise<CachedImg | null> {
    const cached = downloadCache.get(file.fileName);
    if (cached) return { ...cached, via: `${cached.via}-cache` };

    const viaApi = await downloadOneViaApi(file);
    if (viaApi) return { ...viaApi, via: `${viaApi.via}-api` };

    const direct = await tryDirectFileGet(file);
    if (direct) {
      cacheImage(file.fileName, direct);
      return direct;
    }

    const viaUi = await uiDownloadFile(file);
    if (viaUi) return { ...viaUi, via: `${viaUi.via}-ui` };

    return null;
  }

  window.addEventListener('dtx-fn-share-probe', () => {
    refreshPageSignedFetch();
    document.documentElement.setAttribute(
      'data-dtx-fn-share',
      JSON.stringify({
        shareId,
        files: [...files],
        lastListAt,
        hasAuth: Boolean(authSnap.auth),
        hasPageFetch: pageSignedFetch !== bareFetch && pageSignedFetch !== dtxFetchWrapper,
        downloadCacheSize: downloadCache.size,
      }),
    );
    window.dispatchEvent(new CustomEvent('dtx-fn-share-probe-done'));
  });

  /** 自动进入「质检报告」：点击 data-row-key 对应行 */
  window.addEventListener('dtx-fn-share-enter-folder', (ev) => {
    const detail = (ev as CustomEvent).detail as { requestId?: string; folderKey?: string };
    const requestId = detail?.requestId ?? '';
    const folderKey = detail?.folderKey || '/质检报告';
    let ok = false;
    const row =
      document.querySelector(`[role="row"][data-row-key="${folderKey}"]`) ??
      document.querySelector(`[data-row-key="${folderKey}"]`);
    if (row) {
      const el = row as HTMLElement;
      el.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
      );
      el.click();
      ok = true;
    }
    if (requestId) {
      document.documentElement.setAttribute(
        `data-dtx-fn-enter-${requestId}`,
        JSON.stringify({ ok }),
      );
      window.dispatchEvent(
        new CustomEvent('dtx-fn-share-enter-done', { detail: { requestId } }),
      );
    }
  });

  async function fetchShareList(folderPath: string, folderFileId: number): Promise<FnFile[]> {
    refreshPageSignedFetch();
    const bodies = [
      JSON.stringify({ shareId, fileId: folderFileId, path: folderPath }),
      JSON.stringify({ shareId, fileId: folderFileId }),
      JSON.stringify({ shareId, path: folderPath }),
    ];
    const urls = [
      `${apiBase}/api/v1/share/list`,
      `${apiBase}/api/v1/share/files`,
      `${apiBase}/api/v1/share/dir`,
    ];
    const out: FnFile[] = [];
    const seen = new Set<string>();

    const push = (entry: FnFile | null) => {
      if (!entry) return;
      const key = `${entry.fileId}:${entry.path}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(entry);
      mergeFile(entry);
    };

    for (const url of urls) {
      for (const body of bodies) {
        try {
          const res = await signedApiFetch(url, body);
          const text = await res.text();
          if (!text.trim().startsWith('{')) continue;
          ingestListJson(text);
          const json = JSON.parse(text) as Record<string, unknown>;
          extractFiles(json);
          const data = json.data;
          if (data && typeof data === 'object') extractFiles(data);
        } catch {
          /* try next */
        }
      }
    }

    for (const f of files) {
      if (f.path.includes('质检') || f.fileName.includes('克袋') || IMG_EXT_RE.test(f.fileName)) {
        push(f);
      }
    }
    return out.length ? out : files.filter((f) => IMG_EXT_RE.test(f.fileName));
  }

  window.addEventListener('dtx-fn-share-list', async (ev) => {
    const detail = (ev as CustomEvent).detail as {
      requestId: string;
      folderPath?: string;
      folderFileId?: number;
    };
    let result: { ok: boolean; files?: FnFile[]; error?: string; hasAuth?: boolean } = { ok: false };
    try {
      refreshPageSignedFetch();
      const folderPath = detail.folderPath || '/质检报告';
      const folderFileId = detail.folderFileId ?? 2;
      const listed = await fetchShareList(folderPath, folderFileId);
      result = { ok: listed.length > 0, files: listed, hasAuth: Boolean(authSnap.auth) };
      if (!listed.length) result.error = 'list 成功但无 PNG 文件';
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e), hasAuth: Boolean(authSnap.auth) };
    }
    document.documentElement.setAttribute(`data-dtx-fn-list-${detail.requestId}`, JSON.stringify(result));
    window.dispatchEvent(
      new CustomEvent('dtx-fn-share-list-done', { detail: { requestId: detail.requestId } }),
    );
  });

  window.addEventListener('dtx-fn-share-batch', async (ev) => {
    const detail = (ev as CustomEvent).detail as {
      requestId: string;
      files: FnFile[];
      folderPath?: string;
    };
    let result: {
      ok: boolean;
      images?: Record<string, { mime: string; dataBase64: string }>;
      zipBase64?: string;
      via?: string;
      error?: string;
    } = { ok: false };
    try {
      refreshPageSignedFetch();
      result = await downloadAllBatch(detail.files, detail.folderPath || '/质检报告');
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    document.documentElement.setAttribute(`data-dtx-fn-batch-${detail.requestId}`, JSON.stringify(result));
    window.dispatchEvent(
      new CustomEvent('dtx-fn-share-batch-done', { detail: { requestId: detail.requestId } }),
    );
  });

  window.addEventListener('dtx-fn-share-clear-selection', () => {
    clearFileSelections();
  });

  window.addEventListener('dtx-fn-share-parallel', async (ev) => {
    const detail = (ev as CustomEvent).detail as { requestId: string; files: FnFile[] };
    let result: {
      ok: boolean;
      images?: Record<string, { mime: string; dataBase64: string }>;
      via?: string;
      error?: string;
    } = { ok: false };
    try {
      refreshPageSignedFetch();
      const n = await downloadFilesParallelApi(detail.files, 8);
      const images = cachedImagesRecord(detail.files);
      result = {
        ok: n > 0,
        images,
        via: 'api-parallel',
        error: n < detail.files.length ? `并行 ${n}/${detail.files.length}` : undefined,
      };
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    document.documentElement.setAttribute(`data-dtx-fn-parallel-${detail.requestId}`, JSON.stringify(result));
    window.dispatchEvent(
      new CustomEvent('dtx-fn-share-parallel-done', { detail: { requestId: detail.requestId } }),
    );
  });

  window.addEventListener('dtx-fn-share-download', async (ev) => {
    const detail = (ev as CustomEvent).detail as { requestId: string; file: FnFile };
    let result: { ok: boolean; mime?: string; dataBase64?: string; error?: string; via?: string } = { ok: false };
    try {
      refreshPageSignedFetch();
      const packed = await downloadOne(detail.file);
      if (packed) result = { ok: true, mime: packed.mime, dataBase64: packed.dataBase64, via: packed.via };
      else {
        result = {
          ok: false,
          error: '未能获取原图。请确认文件列表可见，或刷新页面后重试',
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result = {
        ok: false,
        error: /invalid sign/i.test(msg)
          ? `${msg}（扩展不能代签；已尝试模拟点「下载」）`
          : msg,
      };
    }
    document.documentElement.setAttribute(`data-dtx-fn-dl-${detail.requestId}`, JSON.stringify(result));
    window.dispatchEvent(
      new CustomEvent('dtx-fn-share-download-done', { detail: { requestId: detail.requestId } }),
    );
  });
})();

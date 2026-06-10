import html2canvas from 'html2canvas';

const CAPTURE_OPTS = {
  backgroundColor: '#ffffff',
  scale: Math.min(2, window.devicePixelRatio || 1),
  useCORS: true,
  allowTaint: true,
  logging: false,
  imageTimeout: 15000,
} as const;

export async function waitForRemoteImages(container: HTMLElement, timeoutMs = 12000): Promise<void> {
  const imgs = Array.from(container.querySelectorAll('img'));
  if (!imgs.length) return;
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          setTimeout(done, timeoutMs);
        }),
    ),
  );
}

export async function captureElementToCanvas(el: HTMLElement): Promise<HTMLCanvasElement> {
  return html2canvas(el, CAPTURE_OPTS);
}

export async function captureElementToBlob(el: HTMLElement): Promise<Blob> {
  const canvas = await captureElementToCanvas(el);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('截图生成失败'))), 'image/png');
  });
}

export async function captureElementToPng(el: HTMLElement, fileName: string): Promise<void> {
  const canvas = await captureElementToCanvas(el);
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
}

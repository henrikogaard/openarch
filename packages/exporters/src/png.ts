import type { Model } from '@openarch/core';
import { exportViewSvg } from './svg';

/**
 * Rasterize a single view to a PNG Blob using the browser canvas API.
 *
 * Browser-only: rejects with a clear error when no `document` is available.
 * `scale` multiplies both the intrinsic SVG size and the backing canvas size.
 */
export function exportViewPng(model: Model, viewId: string, scale = 2): Promise<Blob> {
  if (typeof document === 'undefined') {
    return Promise.reject(
      new Error('exportViewPng requires a browser DOM: `document` is undefined.'),
    );
  }

  const svg = exportViewSvg(model, viewId);
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  return new Promise<Blob>((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      const width = image.naturalWidth || 1;
      const height = image.naturalHeight || 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));

      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('exportViewPng could not acquire a 2D canvas context.'));
        return;
      }

      context.scale(scale, scale);
      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('exportViewPng: canvas.toBlob produced no blob.'));
      }, 'image/png');
    };

    image.onerror = () => {
      reject(new Error('exportViewPng failed to load the generated SVG image.'));
    };

    image.src = dataUrl;
  });
}

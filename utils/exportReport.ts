// utils/exportReport.ts
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy'; // 👈 legacy shim (no deprecation warning)
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';

export type ExportFeedback = {
  uri: string;
  mode: 'shared' | 'clipboard';
};

/** Pick a writable base directory across platforms/SDKs. */
function getBaseDir(): string {
  const FS: any = FileSystem as any;
  // Prefer persisted docs dir; fallback to cache. Some environments only expose one of these.
  return (FS?.documentDirectory ?? FS?.cacheDirectory ?? '') as string;
}

/** Ensure path concatenation is sane (avoid double/missing slashes). */
function joinPath(base: string, fileName: string): string {
  if (!base) return fileName;
  const slash = base.endsWith('/') ? '' : '/';
  return `${base}${slash}${fileName}`;
}

/** Web-only: trigger a CSV file download via Blob. */
function downloadBlobWeb(fileName: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Writes CSV to a local file.
 * - On native, saves to docs/cache and opens share sheet (if available).
 * - On Expo Go iOS (no share), copies CSV to clipboard and returns.
 * - On web, downloads CSV via Blob.
 */
export async function exportCsvSmart(
  fileName: string,
  csv: string,
  _opts?: { suppressAlert?: boolean }
): Promise<ExportFeedback> {
  // Web branch: just download via Blob
  if (Platform.OS === 'web') {
    downloadBlobWeb(fileName, csv);
    return { uri: fileName, mode: 'shared' };
  }

  // Native branch
  const baseDir = getBaseDir();
  const uri = joinPath(baseDir, fileName);

  await FileSystem.writeAsStringAsync(uri, csv);

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, {
      dialogTitle: `Share ${fileName}`,
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
    });
    return { uri, mode: 'shared' };
  }

  // Expo Go iOS fallback: copy to clipboard
  await Clipboard.setStringAsync(csv);
  try {
    await Haptics.selectionAsync();
  } catch {
    // no-op if haptics unavailable
  }

  return { uri, mode: 'clipboard' };
}

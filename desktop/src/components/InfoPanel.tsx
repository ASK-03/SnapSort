import { Calendar, Camera, ExternalLink, FileImage, MapPin, UserCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getFaceThumbnailUrl, getImageMetadata, type ImageMetadata } from '../api';

interface Face {
  id: number;
  name: string | null;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value >= 10 || idx === 0 ? Math.round(value) : value.toFixed(1)} ${units[idx]}`;
}

function formatDateLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const exifMatch = /^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw.trim());
  const normalized = exifMatch
    ? `${exifMatch[1]}-${exifMatch[2]}-${exifMatch[3]}T${exifMatch[4]}:${exifMatch[5]}:${exifMatch[6] || '00'}`
    : raw;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const InfoPanel = ({
  imagePath,
  faces,
  open,
  onFaceClick,
}: {
  imagePath: string;
  faces: Face[];
  open: boolean;
  onFaceClick: (f: Face) => void;
}) => {
  const [metadata, setMetadata] = useState<ImageMetadata | null>(null);

  useEffect(() => {
    if (!imagePath || !open) return;
    let cancelled = false;
    getImageMetadata(imagePath)
      .then((data) => {
        if (!cancelled) setMetadata(data);
      })
      .catch(() => {
        if (!cancelled) setMetadata(null);
      });
    return () => {
      cancelled = true;
    };
  }, [imagePath, open]);

  const filename = metadata?.filename || imagePath.split(/[\\/]/).pop() || 'Unknown';
  const ext = metadata?.format || (filename.includes('.') ? filename.split('.').pop()?.toUpperCase() || 'Unknown' : 'Unknown');
  const subtitle = metadata
    ? `${metadata.width.toLocaleString()} x ${metadata.height.toLocaleString()} · ${formatBytes(metadata.file_size_bytes)}`
    : 'Local file';

  const captureSpecs = [
    metadata?.focal_length,
    metadata?.aperture,
    metadata?.shutter_speed,
    metadata?.iso ? `ISO ${metadata.iso}` : null,
  ].filter(Boolean) as string[];

  const hasCaptureInfo = Boolean(
    metadata?.date_taken || metadata?.camera || metadata?.lens || captureSpecs.length > 0,
  );
  const dateDisplay = formatDateLabel(metadata?.date_taken) || formatDateLabel(metadata?.modified_at);
  const mapUrl =
    metadata?.latitude !== null &&
    metadata?.latitude !== undefined &&
    metadata?.longitude !== null &&
    metadata?.longitude !== undefined
      ? `https://www.openstreetmap.org/?mlat=${metadata.latitude}&mlon=${metadata.longitude}#map=15/${metadata.latitude}/${metadata.longitude}`
      : null;

  return (
    <aside
      aria-label="Photo details"
      aria-hidden={!open}
      inert={!open}
      className={`absolute inset-y-0 right-0 z-10 w-80 bg-viewer-panel border-l border-border overflow-y-auto overscroll-contain transition-[transform,opacity] ease-drawer motion-reduce:transition-none ${
        open ? 'translate-x-0 opacity-100 duration-240' : 'translate-x-full opacity-0 pointer-events-none duration-150'
      }`}
    >
      <div className="flex flex-col p-5 text-text gap-4">
        <div>
          <h2 className="text-sm font-semibold break-all text-text">{filename}</h2>
          <p className="text-xs text-text-mute mt-0.5 tabular-nums">{subtitle}</p>
        </div>

        <div className="h-px bg-border" />

        <section>
          <div className="flex items-center gap-2 text-xs font-medium text-text-mute mb-2.5">
            <UserCircle2 size={14} aria-hidden="true" />
            <span className="tabular-nums">People ({faces.length})</span>
          </div>

          {faces.length === 0 ? (
            <p className="text-xs text-text-mute">No faces detected.</p>
          ) : (
            <div className="space-y-1.5">
              {faces.map((f, idx) => (
                <button
                  key={`${f.id}-${idx}`}
                  type="button"
                  onClick={() => onFaceClick(f)}
                  title={`Show all photos of ${f.name || 'this person'}`}
                  className="pressable w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-left hover:bg-surface-hi hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <div className="w-12 h-12 rounded-full overflow-hidden bg-surface-hi img-frame-outline shrink-0">
                    <img
                      src={getFaceThumbnailUrl(f.id)}
                      className="w-full h-full object-cover block"
                      alt={f.name || `Detected face ${f.id}`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-text truncate">{f.name || 'Unnamed person'}</div>
                    <div className="text-xs text-text-mute">View photos</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {hasCaptureInfo && (
          <>
            <div className="h-px bg-border" />
            <section className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-text-mute">
                <Camera size={14} aria-hidden="true" />
                <span>Capture</span>
              </div>

              {dateDisplay && <Row label="Taken" value={dateDisplay} />}
              {metadata?.camera && <Row label="Camera" value={metadata.camera} />}
              {metadata?.lens && <Row label="Lens" value={metadata.lens} />}

              {captureSpecs.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {captureSpecs.map((spec) => (
                    <span
                      key={spec}
                      className="px-2 py-0.5 rounded-md bg-surface-hi border border-border text-[11px] font-medium text-text-dim tabular-nums"
                    >
                      {spec}
                    </span>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        <div className="h-px bg-border" />

        <section className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-text-mute">
            <MapPin size={14} aria-hidden="true" />
            <span>Location</span>
          </div>

          {metadata?.location_label && mapUrl ? (
            <div className="rounded-xl bg-surface-hi border border-border p-3 space-y-2">
              <p className="text-xs font-medium text-text tabular-nums">{metadata.location_label}</p>
              <a
                href={mapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="pressable inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
              >
                <span>View on map</span>
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            </div>
          ) : (
            <p className="text-xs text-text-mute">No GPS coordinates recorded.</p>
          )}
        </section>

        <div className="h-px bg-border" />

        <section className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-text-mute mb-1.5">
            <FileImage size={14} aria-hidden="true" />
            <span>Details</span>
          </div>

          <Row label="Format" value={ext} />
          {metadata && (
            <>
              <Row
                label="Dimensions"
                value={`${metadata.width.toLocaleString()} x ${metadata.height.toLocaleString()} (${metadata.megapixels} MP)`}
              />
              <Row label="File size" value={formatBytes(metadata.file_size_bytes)} />
            </>
          )}
          {formatDateLabel(metadata?.modified_at) && (
            <div className="flex items-center justify-between gap-3 text-xs py-1.5">
              <span className="text-text-mute inline-flex items-center gap-1.5 shrink-0">
                <Calendar size={12} aria-hidden="true" />
                Modified
              </span>
              <span className="text-text text-right tabular-nums">
                {formatDateLabel(metadata?.modified_at)}
              </span>
            </div>
          )}
          <Row label="Path" value={imagePath} mono />
        </section>
      </div>
    </aside>
  );
};

const Row = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <div className="flex justify-between gap-3 text-xs py-1.5">
    <span className="text-text-mute flex-shrink-0">{label}</span>
    <span
      className={`text-text text-right break-all min-w-0 tabular-nums ${mono ? 'font-mono text-[11px] text-text-dim' : ''}`}
      title={value}
    >
      {value}
    </span>
  </div>
);

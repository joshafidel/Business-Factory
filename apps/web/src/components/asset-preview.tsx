import { Badge } from "@/components/ui";
import { MediaActions } from "@/components/media-actions";

/**
 * Inline preview + download/save actions for an asset row. Videos get a
 * playable player, images a thumbnail; everything else stays a labelled row.
 * Server-renderable — the only client part is the MediaActions island.
 */
export function AssetPreview({
  asset,
}: {
  asset: { id: string; name: string; mimeType: string; approvalStatus?: string };
}) {
  const src = `/api/assets/raw?id=${asset.id}`;
  const isVideo = asset.mimeType.startsWith("video/");
  const isImage = asset.mimeType.startsWith("image/");
  const isAudio = asset.mimeType.startsWith("audio/");

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{asset.name}</span>
        {asset.approvalStatus ? (
          <Badge>{asset.approvalStatus.replaceAll("_", " ")}</Badge>
        ) : null}
      </div>
      {isVideo ? (
        <video
          controls
          playsInline
          preload="metadata"
          src={src}
          className="max-h-[420px] w-full rounded-md bg-black"
        />
      ) : null}
      {isImage ? (
        <img src={src} alt={asset.name} className="max-h-72 w-auto rounded-md" />
      ) : null}
      {isAudio ? <audio controls preload="metadata" src={src} className="w-full" /> : null}
      <MediaActions variant="links" src={src} filename={asset.name} />
    </div>
  );
}

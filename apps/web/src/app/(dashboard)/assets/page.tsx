import { prisma } from "@bf/database";
import Link from "next/link";
import { requireOrgContext } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import {
  Badge,
  EmptyState,
  PageHeader,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";

export const metadata = { title: "Asset Library" };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const ctx = await requireOrgContext();
  const { type } = await searchParams;
  const assets = await prisma.asset.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(type ? { type: type as never } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const TYPES = ["ALL", "TEXT", "JSON", "IMAGE", "AUDIO", "VIDEO", "DOCUMENT", "WEBSITE"];

  return (
    <>
      <PageHeader
        title="Asset Library"
        description="Everything generated or uploaded, with storage location and approval state."
      />
      <div className="mb-4 flex flex-wrap gap-1">
        {TYPES.map((t) => (
          <Link
            key={t}
            href={t === "ALL" ? "/assets" : `/assets?type=${t}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              (t === "ALL" && !type) || type === t
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {t}
          </Link>
        ))}
      </div>
      {assets.length === 0 ? (
        <EmptyState title="No assets" hint="Approved workflow outputs are saved here." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Type</TH>
              <TH>Size</TH>
              <TH>Source</TH>
              <TH>Storage</TH>
              <TH>Approval</TH>
              <TH>Created</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {assets.map((asset) => (
              <TR key={asset.id}>
                <TD className="max-w-xs truncate font-medium">{asset.name}</TD>
                <TD>
                  <Badge>{asset.type}</Badge>
                </TD>
                <TD className="text-xs">{formatBytes(asset.sizeBytes)}</TD>
                <TD className="max-w-48 truncate text-xs text-muted-foreground">
                  {asset.source ?? "—"}
                </TD>
                <TD className="text-xs">{asset.storageDriver}</TD>
                <TD>
                  <StatusBadge status={asset.approvalStatus} />
                </TD>
                <TD className="text-xs text-muted-foreground">{formatDate(asset.createdAt)}</TD>
                <TD>
                  <span className="flex items-center gap-3 whitespace-nowrap">
                    <a
                      href={`/api/assets/raw?id=${asset.id}`}
                      className="text-xs text-primary hover:underline"
                      target="_blank"
                    >
                      View
                    </a>
                    <a
                      href={`/api/assets/raw?id=${asset.id}&download=1`}
                      download={asset.name}
                      className="text-xs text-primary hover:underline"
                    >
                      Download
                    </a>
                  </span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}

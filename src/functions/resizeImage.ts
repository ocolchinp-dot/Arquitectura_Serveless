import { app, EventGridEvent, InvocationContext } from "@azure/functions";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobClient, BlobServiceClient } from "@azure/storage-blob";
import path from "node:path";
import sharp from "sharp";

interface BlobCreatedData {
  api?: string;
  contentType?: string;
  url: string;
}

const supportedContentTypes = new Set(["image/jpeg", "image/png"]);
const credential = new DefaultAzureCredential();

function getRequiredPositiveInteger(name: string): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} debe ser un entero positivo.`);
  }
  return value;
}

function blobNameFromSubject(subject: string): string | undefined {
  const marker = "/blobs/";
  const position = subject.indexOf(marker);
  if (position < 0) return undefined;
  return subject
    .slice(position + marker.length)
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .join("/");
}

function resizedBlobName(originalName: string): string {
  const parsed = path.posix.parse(originalName);
  return path.posix.join(parsed.dir, `${parsed.name}-resized${parsed.ext.toLowerCase()}`);
}

function isSupportedFileName(name: string): boolean {
  return /\.(jpe?g|png)$/i.test(name);
}

export async function resizeImage(
  event: EventGridEvent & { data: BlobCreatedData },
  context: InvocationContext,
): Promise<void> {
  const originalName = blobNameFromSubject(event.subject);
  if (!originalName || !isSupportedFileName(originalName)) {
    context.warn(`Evento omitido: blob no compatible. subject=${event.subject}`);
    return;
  }

  const sourceBlob = new BlobClient(event.data.url, credential);
  const sourceProperties = await sourceBlob.getProperties();
  const sourceContentType = sourceProperties.contentType?.toLowerCase();
  if (!sourceContentType || !supportedContentTypes.has(sourceContentType)) {
    context.warn(`Evento omitido: ${originalName} tiene Content-Type no permitido (${sourceContentType ?? "sin definir"}).`);
    return;
  }

  const outputWidth = getRequiredPositiveInteger("OUTPUT_WIDTH");
  const outputHeight = getRequiredPositiveInteger("OUTPUT_HEIGHT");
  const outputName = resizedBlobName(originalName);
  const targetService = new BlobServiceClient(new URL(event.data.url).origin, credential);
  const targetBlob = targetService.getContainerClient("resized").getBlockBlobClient(outputName);

  const existing = await targetBlob.exists();
  if (existing) {
    context.log(`Resultado idempotente: ${outputName} ya existe; se conserva sin sobrescribir.`);
    return;
  }

  context.log(`Procesando ${originalName}. Content-Type=${sourceContentType}.`);
  const originalBuffer = await sourceBlob.downloadToBuffer();
  const image = sharp(originalBuffer, { failOn: "error" });
  const originalMetadata = await image.metadata();
  if (!originalMetadata.width || !originalMetadata.height || !["jpeg", "png"].includes(originalMetadata.format ?? "")) {
    throw new Error(`${originalName} no es una imagen JPEG o PNG válida.`);
  }

  const resizedBuffer = await image
    .resize({ width: outputWidth, height: outputHeight, fit: "inside", withoutEnlargement: true })
    .toBuffer();
  const finalMetadata = await sharp(resizedBuffer).metadata();

  try {
    await targetBlob.uploadData(resizedBuffer, {
      blobHTTPHeaders: { blobContentType: sourceContentType },
      conditions: { ifNoneMatch: "*" },
    });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 412) {
      context.log(`Resultado idempotente: ${outputName} fue creado por otra entrega del mismo evento.`);
      return;
    }
    throw error;
  }

  context.log(
    `Redimensionamiento exitoso: archivo=${originalName}; original=${originalMetadata.width}x${originalMetadata.height}; final=${finalMetadata.width}x${finalMetadata.height}; resultado=${outputName}.`,
  );
}

app.eventGrid("resizeImage", {
  handler: resizeImage,
});

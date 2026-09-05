# Redimensionador serverless de imágenes en Azure

## Arquitectura

`Azure Blob Storage (originals)` -> `Event Grid BlobCreated` -> `Azure Function (TypeScript + Sharp)` -> `Azure Blob Storage (resized)`.

La suscripción de Event Grid filtra el prefijo del sujeto `originals`; por ello, las escrituras en `resized` no pueden disparar la función.

## Comportamiento

- Acepta únicamente JPEG y PNG con `Content-Type` permitido.
- Conserva el blob de entrada sin cambios y crea `nombre-resized.ext` en `resized`.
- Conserva el `Content-Type` original.
- Usa `OUTPUT_WIDTH` y `OUTPUT_HEIGHT`, con `fit: "inside"` y sin ampliación.
- Registra dimensiones de entrada/salida y el resultado.
- Es idempotente: si el destino existe no lo sobrescribe; una carrera de entregas duplicadas se controla con `If-None-Match: *`.

## Instalación local

```powershell
npm install
npm run build
Copy-Item local.settings.example.json local.settings.json
```

Para ejecutar localmente se requieren Azure Functions Core Tools v4 y Azurite. No suba `local.settings.json` al repositorio.

## Recursos Azure usados

- Resource Group: `rg-imgresbc860ac026`
- Storage Account privada: `imgresbc860ac026storage`
- Function App Flex Consumption / Node.js 22: `imgresbc860ac026func`
- Contenedores privados: `originals`, `resized`

La identidad administrada de la Function App recibe exclusivamente `Storage Blob Data Contributor` sobre la cuenta de almacenamiento. El acceso anónimo a blobs está deshabilitado y TLS mínimo es 1.2.

## Despliegue

Compile con `npm run build`. En Flex Consumption publique con One Deploy mediante Core Tools actualizado:

```powershell
func azure functionapp publish imgresbc860ac026func --build-remote true
```

La suscripción `evs-originals-image-resize` ya está creada para `Microsoft.Storage.BlobCreated`, con el filtro de sujeto `/blobServices/default/containers/originals/blobs/`, apuntando a la función `resizeImage`.

## Prueba

1. Cargue manualmente un JPEG o PNG en `originals`.
2. Espere la entrega de Event Grid.
3. Confirme que aparece `*-resized.*` en `resized`, con Content-Type igual al origen.
4. Revise Application Insights para el log de dimensiones.
5. Repita la entrega del evento: el resultado debe conservarse sin sobrescritura.

## Resultado verificado

El 5 de septiembre de 2026 se cargó `imagen-prueba-1600x1200.png` en `originals`. Event Grid activó la Function y generó automáticamente `imagen-prueba-1600x1200-resized.png` en `resized`. Se verificó `1600x1200 -> 800x600`, `image/png` en ambos blobs y un segundo evento que registró el comportamiento idempotente sin crear ni sobrescribir otro resultado.

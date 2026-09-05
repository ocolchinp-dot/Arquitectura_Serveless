# Entrega: redimensionamiento serverless de imágenes

> Estado de validación: despliegue y prueba por Event Grid completados el 5 de septiembre de 2026. Las capturas de portal siguen pendientes porque el navegador integrado no estuvo disponible; no se inventaron archivos en `evidencias`.

## 1. Descripción breve de la solución

La solución procesa imágenes JPEG/PNG de manera asíncrona cuando se crean en `originals`, empleando Sharp en una Azure Function TypeScript, y guarda una copia redimensionada en `resized`.

## 2. Arquitectura implementada

Azure Blob Storage (`originals`) -> Event Grid BlobCreated -> Azure Function Node.js v4 -> Azure Blob Storage (`resized`).

## 3. Recursos creados

- Resource Group: `rg-imgresbc860ac026`.
- Storage Account: `imgresbc860ac026storage` (privada, TLS 1.2).
- Function App: `imgresbc860ac026func` (Flex Consumption, Node.js 22).
- Contenedores: `originals` y `resized`.

Evidencia requerida al finalizar: captura 1 y captura 5.

## 4. Configuración del evento

La suscripción `evs-originals-image-resize` filtra `Microsoft.Storage.BlobCreated` cuyo sujeto comienza por `/blobServices/default/containers/originals/blobs/` y entrega a `resizeImage`. Su estado de aprovisionamiento es `Succeeded`.

Evidencia requerida al finalizar: captura 4.

## 5. Explicación del código

`src/functions/resizeImage.ts` valida nombre y Content-Type, descarga el blob origen con identidad administrada, obtiene metadatos con Sharp, aplica `resize({ fit: "inside", withoutEnlargement: true })` y sube el resultado con el mismo Content-Type.

## 6. Configuración de dimensiones

Las variables de aplicación son `OUTPUT_WIDTH=800` y `OUTPUT_HEIGHT=600`.

Evidencia requerida al finalizar: captura 6.

## 7. Permisos y seguridad

La Function usa identidad administrada con `Storage Blob Data Contributor` limitado a la cuenta de almacenamiento. Los contenedores no permiten acceso anónimo; no hay secretos en el código ni en este documento.

Evidencia requerida al finalizar: captura 7.

## 8. Logs y observabilidad

La función registra nombre, dimensiones original/final y resultado. Application Insights almacena los logs de ejecución.

Evidencia requerida al finalizar: captura 8.

## 9. Prueba completa

Se cargó manualmente mediante Azure CLI únicamente `imagen-prueba-1600x1200.png` en `originals`, con `Content-Type image/png`. Event Grid invocó la Function sin ejecución manual y creó `imagen-prueba-1600x1200-resized.png` en `resized`.

- Dimensiones originales verificadas: `1600x1200`.
- Dimensiones finales verificadas: `800x600`.
- Content-Type de origen y destino: `image/png`.
- El blob original sigue en `originals` con tamaño `28898` bytes; el resultado tiene `8593` bytes.
- Application Insights registró: `Redimensionamiento exitoso: archivo=imagen-prueba-1600x1200.png; original=1600x1200; final=800x600; resultado=imagen-prueba-1600x1200-resized.png.`
- Al cargar nuevamente el mismo origen, Application Insights registró: `Resultado idempotente: imagen-prueba-1600x1200-resized.png ya existe; se conserva sin sobrescribir.`

No hay capturas aún. Cuando el navegador esté disponible, guarde las diez capturas solicitadas con los nombres `01-storage-contenedores.png` a `10-comparacion-dimensiones.png` dentro de `evidencias` y sustituya estas referencias pendientes.

## 10. Conclusiones

La arquitectura desacopla carga y procesamiento, escala por eventos y evita modificar el archivo de entrada.

## 11. Respuestas

**¿Cómo evita la solución que la imagen redimensionada vuelva a ejecutar la función?** La suscripción Event Grid filtra solo eventos de creación bajo el contenedor `originals`; `resized` queda fuera del prefijo observado.

**¿Qué ocurriría si Azure entrega dos veces el evento correspondiente a una misma imagen?** La segunda ejecución detecta que existe el blob de destino y no lo sobrescribe. Si ambas llegan simultáneamente, la condición `If-None-Match: *` permite solo una escritura y la otra se considera idempotente.

**¿Qué ventajas y limitaciones presenta esta arquitectura frente a procesar la imagen dentro de una API síncrona?** Reduce latencia para el cliente, desacopla y escala el procesamiento; a cambio, el resultado es eventual, requiere observabilidad/reintentos y no se puede devolver la imagen final en la misma respuesta HTTP.

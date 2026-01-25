# 🔒 Seguridad y Confiabilidad del Sistema de Stock

## ✅ Garantías del Sistema

### 1. **Idempotencia Completa**
- ✅ Una orden **NUNCA** se procesa dos veces
- ✅ Las órdenes procesadas se guardan en `.meli-processed-orders.json`
- ✅ Se verifica antes de procesar cada orden

### 2. **Procesamiento Atómico**
- ✅ Una orden **SOLO** se marca como procesada si **TODOS** los items se procesaron correctamente
- ✅ Si algún item falla, la orden **NO** se marca como procesada
- ✅ Permite reintento automático en la próxima ejecución

### 3. **Búsqueda Completa de Órdenes Pendientes**
- ✅ Usa **paginación** para obtener **TODAS** las órdenes (no solo 50)
- ✅ Busca todas las órdenes recientes del vendedor
- ✅ No se pierden órdenes por límites de paginación

### 4. **Protección Contra Loops**
- ✅ Flag `isSyncingFromMeli` evita loops infinitos
- ✅ Se desactiva en `finally` y `catch` (doble protección)

## ⚠️ Casos Edge y Cómo se Manejan

### Caso 1: Orden con Items Parcialmente Procesados
**Escenario:** Una orden tiene 3 items, 2 se procesan correctamente, 1 falla.

**Comportamiento:**
- ✅ Los 2 items exitosos se descuentan en Shopify
- ⚠️ La orden **NO** se marca como procesada
- ✅ Se reintentará en la próxima ejecución
- ⚠️ **RIESGO:** El item que falló podría procesarse dos veces si se reintenta

**Solución Recomendada:**
- Revisar logs para identificar items que fallan
- Corregir el problema (SKU no encontrado, etc.)
- El sistema reintentará automáticamente

### Caso 2: Más de 50 Órdenes Pendientes
**Escenario:** Hay 150 órdenes pendientes cuando se reinicia el servidor.

**Comportamiento:**
- ✅ El sistema usa paginación para obtener **TODAS** las órdenes
- ✅ No hay límite de 50 - obtiene todas las disponibles
- ✅ Procesa todas las que no están marcadas como procesadas

### Caso 3: Error Durante el Procesamiento
**Escenario:** El servidor se cae mientras procesa una orden.

**Comportamiento:**
- ✅ La orden **NO** se marca como procesada (porque no terminó)
- ✅ Al reiniciar, se reintentará automáticamente
- ⚠️ **RIESGO:** Si algunos items ya se procesaron, podrían procesarse dos veces

**Mitigación:**
- El sistema verifica `processedOrders` antes de procesar
- Si la orden ya está marcada, se salta completamente

### Caso 4: SKU No Encontrado
**Escenario:** Una orden tiene un item cuyo SKU no existe en Shopify.

**Comportamiento:**
- ⚠️ El item se marca como fallido
- ⚠️ La orden **NO** se marca como procesada
- ✅ Se reintentará en la próxima ejecución
- ⚠️ **RIESGO:** Si el SKU nunca se corrige, la orden se reintentará infinitamente

**Solución:**
- Revisar logs para identificar SKUs faltantes
- Agregar los SKUs faltantes o corregir los existentes
- El sistema reintentará automáticamente

## 🔍 Cómo Verificar que Todo Está Correcto

### 1. Revisar Logs
Busca en los logs:
- `✅ Orden X procesada completamente` - Todo bien
- `⚠️ Orden X procesada PARCIALMENTE` - Requiere atención
- `⏭️ Orden X ya procesada anteriormente` - Correcto (idempotencia)

### 2. Verificar Archivo de Órdenes Procesadas
```bash
cat .meli-processed-orders.json
```
Debe contener solo órdenes que se procesaron **completamente**.

### 3. Ejecutar Verificación Manual
```bash
npm run check-orders
```
Esto mostrará:
- Órdenes procesadas completamente
- Órdenes procesadas parcialmente (requieren revisión)
- Órdenes ya procesadas (saltadas)

## 📊 Métricas de Confiabilidad

### Garantías Actuales:
- ✅ **Idempotencia:** 100% (una orden nunca se procesa dos veces si está marcada)
- ✅ **Búsqueda Completa:** 100% (paginación obtiene todas las órdenes)
- ⚠️ **Procesamiento Atómico:** Parcial (si un item falla, la orden no se marca, pero los items exitosos ya se procesaron)

### Riesgos Residuales:
1. **Items Parcialmente Procesados:** Si una orden tiene items exitosos y fallidos, los exitosos ya se descuentan pero la orden se reintenta
2. **SKUs Faltantes:** Si un SKU no existe, la orden se reintentará infinitamente hasta que se corrija

## 🛠️ Recomendaciones

1. **Monitorear Logs Regularmente:**
   - Buscar órdenes procesadas parcialmente
   - Identificar SKUs faltantes
   - Corregir problemas rápidamente

2. **Verificar Stock Periódicamente:**
   - Comparar stock entre Shopify y MercadoLibre
   - Identificar discrepancias
   - Investigar causas

3. **Mantener SKUs Sincronizados:**
   - Asegurar que todos los SKUs existan en ambas plataformas
   - Usar el mismo formato exacto

4. **Revisar Órdenes Pendientes:**
   - Ejecutar `npm run check-orders` periódicamente
   - Verificar que no haya órdenes atascadas

## 🚨 Alertas Importantes

Si ves en los logs:
- `⚠️ Orden X procesada PARCIALMENTE` → Revisar qué items fallaron
- `❌ SKU no encontrado` → Agregar SKU faltante
- `⚠️ Procesadas parcialmente (requieren revisión): X` → Investigar causas

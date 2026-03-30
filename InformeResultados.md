# 📊 Informe de Pruebas de Rendimiento — Sistema Transaccional

**Asunto:** Análisis de Pruebas de Carga — Escenario de Autenticación y Saldo de Transacciones  
**Fecha de generación:** 30 de marzo de 2026  



## 🛰️ 1. Evaluación de Criterios de Aceptación (SLA)

De acuerdo con los objetivos de nivel de servicio (SLO) definidos para el sistema, se presentan los siguientes resultados:

| Métrica | Objetivo (SLA) | Resultado Obtenido | Estado |
|---|---|---|---|
| Latencia (p95) | < 1500 ms | 1420 ms (1.42 s) | ✅ CUMPLE |
| Tasa de Error | < 3.00 % | 2.44 % | ✅ CUMPLE |
| Disponibilidad | > 97.00 % | 97.55 % (Checks) | ✅ CUMPLE |

> **⚠️ CONCLUSIÓN FINAL:** La prueba se considera **EXITOSA (PASSED)**. El sistema es capaz de soportar la carga de **140 VUs concurrentes** bajo los parámetros de latencia y errores permitidos. Sin embargo, se observa un **margen estrecho en la tasa de errores** (2.44% vs límite 3.00%) que requiere atención prospectiva antes de escalar la carga.

---

## 📈 2. Análisis de Rendimiento (Throughput)

- **Throughput Total:** El sistema procesó **276,650 transacciones** durante toda la ejecución de la prueba.
- **Throughput Promedio:** Se mantuvo un ritmo de **73.18 TPS** (Transacciones por Segundo), con picos observados de hasta **82.6/s** según el monitoreo gráfico.
- **Análisis Operacional:** Para un servicio de consulta de saldos o autenticación, 73–83 TPS representa un rendimiento sólido bajo carga media-alta en servicios transaccionales. La estabilidad se mantuvo constante con 140 VUs, lo que indica que el sistema no colapsó estructuralmente, pero alcanzó un **punto de saturación incipiente**.

---

## ⏱️ 3. Análisis de Latencia y Distribución

El análisis de los tiempos de respuesta revela una **distribución asimétrica hacia la derecha (cola larga)**:

| Percentil / Métrica | Valor | Interpretación |
|---|---|---|
| Mínimo | 191.86 ms | Mejor escenario posible |
| Mediana (p50) | 613.42 ms | 50% de usuarios con respuesta rápida |
| Promedio | 861.68 ms | Elevado respecto a la mediana → presencia de outliers |
| p90 | 1,280 ms | 10% de peticiones superan 1.28 s |
| p95 | 1,420 ms | Límite crítico del SLA (< 1500 ms) |
| Máximo | 29.93 s | Outlier extremo, petición bloqueada o timeout |

### Diagnóstico de la distribución

- **Mediana (613 ms):** El 50% de los usuarios experimenta respuestas rápidas y satisfactorias.
- **Promedio (861 ms):** Se encuentra significativamente por encima de la mediana, confirmando la presencia de peticiones lentas que sesgan el promedio al alza.
- **p95 (1420 ms):** Es más del doble de la mediana. Esto confirma que el 5% de las peticiones están cerca del límite del SLA, probablemente debido a procesos de garbage collection, latencia de red o bloqueos de base de datos intermitentes.
- **Máximo (29.93 s):** Valor extremo que sugiere al menos una petición que quedó bloqueada esperando un recurso (timeout de conexión a BD o lock de concurrencia).

---

## 🔴 4. Análisis de Errores (Diagnóstico de Fallos)

### 4.1 Resumen de Errores por Stage y Tipo

| Stage | Tipo HTTP | Cantidad | Tasa aproximada | Clasificación |
|---|---|---|---|---|
| Stage 0 | HTTP 5xx | 1 | 0.000265/s | Ruido de red (network jitter) |
| Stage 1 | HTTP 4xx | 769 | 0.203409/s | ⚠️ Errores de cliente/autenticación |
| Stage 1 | HTTP 5xx | 5,987 | 1.583625/s | 🔴 Errores de servidor — fallo estructural |
| Stage 2 | HTTP 5xx | 2 | 0.000529/s | Ruido de red (network jitter) |
| **Total** | | **6,759** | | |

> **Corrección respecto a versiones anteriores del análisis:** El total de errores en Stage 1 asciende a **6,756 errores** (769 HTTP 4xx + 5,987 HTTP 5xx), no 5,907 como podría haberse reportado agrupando únicamente los 5xx. Esta distinción es importante para el diagnóstico.

### 4.2 Interpretación diferenciada por tipo de error

**HTTP 4xx en Stage 1 (769 errores):**
Representan errores del lado del cliente durante el pico de carga. Las causas más probables son:
- Tokens de autenticación expirados o inválidos bajo alta concurrencia
- Rate limiting activado por el gateway o el backend
- Payloads malformados por race conditions en la generación de peticiones

**HTTP 5xx en Stage 1 (5,987 errores):**
Son los fallos más críticos, representando un error del servidor que no pudo procesar la solicitud. Las causas más probables son:
- Saturación del pool de conexiones a la base de datos
- Límites de descriptores de archivos alcanzados en el backend
- Una dependencia externa (como un validador de tokens o servicio de sesiones) que alcanzó su cuota o se saturó

**Stage 0 y Stage 2 (1 y 2 errores):**
Se consideran errores aleatorios de red y no representan una falla estructural.

---

## 📉 5. Análisis del Comportamiento Temporal (Monitoreo Gráfico)

El gráfico de monitoreo (VUs vs http_reqs en el tiempo) revela un comportamiento anómalo que no debe ignorarse:

### 5.1 Drop abrupto entre ~01:48 y ~02:00

Se observa una **caída dramática de VUs desde ~140 hasta casi 0** durante aproximadamente 10–12 minutos, seguida de una recuperación progresiva. Este comportamiento es atípico y merece investigación específica.

**Hipótesis de la caída:**
1. **Reinicio o crash del servicio backend** que forzó el cierre de conexiones activas
2. **Timeout masivo de conexiones TCP** que el load balancer no pudo renegociar a tiempo
3. **Comportamiento del script de k6**: un error en la lógica de iteración que detuvo virtualmente todos los VUs simultáneamente
4. **Saturación de red o DNS** que impidió que nuevas peticiones se completaran

### 5.2 Recuperación y estabilización post-caída

A partir de las ~02:00, el sistema se recupera y estabiliza en ~140 VUs con un throughput de ~82.6/s. Esto sugiere que la caída fue transitoria y el sistema tiene capacidad de recuperación, pero la causa raíz del drop debe identificarse y documentarse.

> **⚠️ Recomendación:** Correlacionar el intervalo 01:48–02:00 con los logs del servidor, métricas de infraestructura (CPU, memoria, conexiones activas) y logs de k6 para determinar el origen exacto de la caída.

---

## 🔍 6. Diagnóstico Técnico de Cuellos de Botella

### 6.1 Saturación en el Backend
La cercanía del error rate al límite del 3% indica que **140 VUs representa el techo operacional actual** del sistema. Superar esta carga sin ajustes de infraestructura probablemente dispararía los errores de forma exponencial, rompiendo el SLA.

### 6.2 Variabilidad de Respuesta
La brecha significativa entre la mediana (613 ms) y el p95 (1,420 ms) apunta a una **falta de optimización en la gestión de recursos concurrentes**. Un sistema bien optimizado tiene percentiles más comprimidos.

### 6.3 Encadenamiento de Latencia (I/O Bound)
El alto `http_req_duration` comparado con la estabilidad del TPS sugiere que el backend está **esperando recursos** en lugar de computar activamente. El patrón de espera elevado apunta a I/O de base de datos como el cuello de botella primario.

### 6.4 Concentración de Fallos en Stage 1
El hecho de que prácticamente todos los errores se concentren en un único stage indica un **componente o transición específica del flujo** que no escala adecuadamente. Esto hace que el problema sea acotado y tratable sin necesidad de refactorizaciones masivas.

---

## 💡 7. Recomendaciones Accionables

### 🚀 Optimización del Backend

| Prioridad | Acción | Impacto Esperado |
|---|---|---|
| 🔴 Alta | **Connection Pooling:** Revisar y ampliar el pool de conexiones a BD (PgBouncer / HikariCP) | Reducción directa de errores 5xx en Stage 1 |
| 🔴 Alta | **Identificar causa del HTTP 4xx:** Revisar lógica de tokens/sesiones bajo concurrencia | Eliminar los 769 errores de autenticación |
| 🟡 Media | **Caching con Redis:** Introducir caché para consultas de saldo frecuentes | Reducción de latencia p95, menos carga en BD |
| 🟡 Media | **Optimización de queries:** Revisar índices y queries en el periodo de pico | Mejora del p95 y reducción del máximo extremo |

### 🏗️ Infraestructura y Escalado

- **Autoscaling:** Configurar políticas de escalado horizontal basadas en uso de CPU (> 60%) y tasa de errores (> 1.5%) para manejar picos que superen los 80 TPS.
- **Load Balancing:** Revisar los algoritmos de balanceo para asegurar distribución uniforme entre todos los nodos y evitar hot-spots.
- **Límites del sistema operativo:** Revisar y ajustar `ulimit` (descriptores de archivos, conexiones TCP) en los servidores de backend.

### 📊 Monitoreo y Observabilidad

- **APM (Application Performance Monitoring):** Implementar rastreo distribuido (OpenTelemetry / Jaeger / Datadog APM) para identificar exactamente qué microservicio o query causó los errores en Stage 1.
- **Análisis de Logs:** Correlacionar los fallos HTTP 4xx y 5xx con errores específicos en los logs del servidor durante el periodo de estrés (especialmente el intervalo del drop gráfico).
- **Dashboard de métricas en tiempo real:** Configurar alertas automáticas cuando el error rate supere el 1.5% para tener margen de reacción antes de romper el SLA.

---

## 📋 8. Resumen Ejecutivo

| Aspecto | Estado | Observación |
|---|---|---|
| Cumplimiento de SLA | ✅ PASS | Todos los criterios cumplidos, margen estrecho en errores |
| Throughput | ✅ Sólido | 73–83 TPS estable bajo 140 VUs |
| Latencia | ⚠️ Aceptable | p95 en 1,420 ms, cerca del límite; cola larga preocupante |
| Errores | ⚠️ Controlado | 2.44%, pero 6,756 errores en Stage 1 requieren corrección |
| Drop gráfico | 🔴 Investigar | Caída abrupta entre 01:48–02:00 sin causa documentada |
| Capacidad de escala | ⚠️ Limitada | 140 VUs es el techo actual; escalar requiere optimizaciones |

> **El sistema está operativo y dentro del SLA, pero se recomienda no incrementar la carga de producción por encima de los niveles actuales hasta resolver los errores de Stage 1 y determinar la causa del drop temporal observado en el monitoreo.**

---

*Informe generado el: 30 de marzo de 2026*
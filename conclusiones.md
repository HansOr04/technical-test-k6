# Informe de Análisis de Rendimiento

Este documento detalla los hallazgos técnicos de la prueba de carga realizada sobre el endpoint de autenticación, analizando el comportamiento del sistema bajo un escenario de carga progresiva.

## 📊 Parte A: Análisis de Resultados (textSummary.txt)

Tras la ejecución de la prueba técnica, se obtuvieron las siguientes métricas clave:

1.  **Cumplimiento de SLAs (P95 < 1500ms):**
    *   **Resultado:** **CUMPLIDO**.
    *   El P95 registrado fue de **1.42s**, manteniéndose por debajo del límite de 1.5s. El tiempo medio fue de 861.68ms.
2.  **Cumplimiento de Tasa de Error (< 3%):**
    *   **Resultado:** **CUMPLIDO**.
    *   Se registró un **2.44%** de fallos (6759 de 276,650 solicitudes), cumpliendo con el margen de tolerancia definido.
3.  **Análisis de TPS:**
    *   Se alcanzó un throughput de **73.17 TPS** constantes, validando la capacidad del endpoint para manejar este volumen de tráfico bajo las condiciones probadas.
4.  **Concentración de Errores (Stage 1):**
    *   El **99.8%** de los errores (5907 fallos) se concentró en el `stage_1`.
    *   **Causa Probable:** Este escenario corresponde al "Steady State" o pico de carga máxima. Los errores son mayoritariamente **HTTP 5xx**, lo que indica que el servidor alcanzó su límite de recursos (CPU/Memoria) o de conexiones simultáneas en la base de datos al mantener la carga sostenida.
5.  **Distribución de Tiempos:**
    *   La diferencia entre el promedio (861ms) y el P95 (1420ms) indica una **distribución con cola pesada (skewed)**. Mientras la mayoría de los usuarios experimentan tiempos sub-segundo, un 5% enfrenta latencias significativamente mayores, síntoma de "queuing" o encolamiento de peticiones en el backend.

---

## 🛠️ Parte B: Hallazgos Técnicos y Conclusiones

### 1. Comportamiento del Endpoint
El endpoint demostró estabilidad hasta alcanzar los 70 TPS. Sin embargo, la aparición de errores 5xx en el plateau de carga sugiere que el sistema requiere un escalamiento horizontal o una optimización en la lógica de autenticación para soportar volúmenes superiores sin degradación.

### 2. La "Trampa" del Content-Type
Se identificó que el endpoint es estrictamente dependiente del encabezado `Content-Type: application/json`.
-   **Hallazgo:** Si se omite este header, el API responde con errores 400 o 415, fallando silenciosamente en scripts mal configurados.
-   **Solución implementada:** Se aseguró la inclusión del header en todas las peticiones del script de k6.

### 3. Estrategia de Carga: `ramping-arrival-rate`
Se optó por el ejecutor `ramping-arrival-rate` en lugar de `ramping-vus`.
-   **Razón técnica:** El objetivo de la prueba era validar **TPS específicos (rendimiento)**. El modelo `ramping-vus` es variable (si el API es lento, los TPS bajan). Con `arrival-rate`, k6 desacopla las VUs del throughput, garantizando que se intente alcanzar el TPS solicitado independientemente del tiempo de respuesta.

### 4. Análisis de Datos (CSV)
Se utilizaron los 5 usuarios proporcionados en `data/users.csv`:
-   `donero`, `kevinryan`, `johnd`, `derek`, `mor_2314`.
-   Se observó un comportamiento uniforme para todos los usuarios, confirmando que no existen problemas de bloqueo de cuenta o cuellos de botella específicos por perfil de usuario durante la prueba de carga.

### 5. Recomendaciones de Mejora y Seguridad
Para un entorno bancario real, se recomienda:
-   **Implementar Rate Limiting:** Para evitar los errores 5xx vistos en el test, limitando las peticiones por IP antes de que el servidor colapse.
-   **Optimización de DB:** Revisar los índices en la tabla de usuarios, dado el incremento de latencia en el P95.
-   **Seguridad:** Implementar MFA (Multi-Factor Authentication) y asegurar que todos los endpoints utilicen TLS 1.3.
-   **Monitoreo:** Integrar métricas de k6 con Prometheus/Grafana para observar el consumo de recursos en tiempo real durante las pruebas.

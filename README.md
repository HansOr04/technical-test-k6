#  K6 Performance Testing PoC

Proyecto de automatización de pruebas de rendimiento sobre el endpoint de autenticación utilizando **k6 v0.54.0**. Este repositorio contiene la configuración, scripts y reportes necesarios para validar la capacidad del sistema bajo carga.

## 🛠️ Instalación y Requisitos

### Prerrequisitos
- Acceso a Internet.
- **k6 v0.54.0** instalado.

### Instalación de k6 por SO

#### Windows (vía Chocolatey)
```powershell
choco install k6
```

#### macOS (vía Homebrew)
```bash
brew install k6
```

#### Linux (Debian/Ubuntu)
```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/bin/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

---

## 🚀 Ejecución de Pruebas

El proceso de ejecución debe seguir un orden lógico para asegurar la estabilidad del entorno.

### 1. Smoke Test (Prueba de Humo)
Valida conectividad, headers (Content-Type) y validez de las credenciales en `data/users.csv`.
```bash
k6 run scripts/smoke-test.js
```

### 2. Load Test (Prueba de Carga completa)
Ejecuta el escenario de estrés con rampas de tráfico y validación de SLAs.
```bash
k6 run scripts/login-load-test.js
```

---

## 📊 Reportes y Resultados

Los resultados se generan automáticamente tras cada ejecución detallada:

-   **Resumen en Consola:** Estadísticas inmediatas al finalizar el script.
-   **Reporte JSON:** Ubicado en `results/summary.json` para integración con herramientas de CI/CD.
-   **Análisis Detallado:** Consulte el archivo [conclusiones.md](conclusiones.md) para un desglose técnico de los hallazgos, SLAs y recomendaciones bancarias.

---

## ⚖️ Umbrales de Aceptación (SLAs)

La prueba se considera satisfactoria si cumple los siguientes criterios automatizados en el script:
-   **Tiempo de Respuesta (P95):** Menor a 1500ms.
-   **Tasa de Error:** Menor al 3%.
-   **Checks:** Validaciones funcionales exitosas en >97% de las iteraciones.

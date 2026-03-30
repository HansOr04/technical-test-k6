// =============================================================================
// login-load-test.js
// Prueba de carga — POST /auth/login  |  FakeStore API
// Executor: ramping-arrival-rate (control de TPS, no de VUs)
// k6 v0.54.0
// =============================================================================

import http       from 'k6/http';
import { check }  from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Trend } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';
import papaparse  from 'https://jslib.k6.io/papaparse/5.1.1/index.js';

// =============================================================================
// MÉTRICAS CUSTOM
// Permiten segmentar resultados más allá de las métricas built-in de k6.
// =============================================================================

/** Cantidad total de logins que recibieron un token válido. */
const loginExitosos = new Counter('login_exitosos');

/** Cantidad total de logins que fallaron (sin token o status != 200). */
const loginFallidos = new Counter('login_fallidos');

/**
 * Tiempo de respuesta por cada petición de login.
 * Trend expone p50 / p90 / p95 / p99 / min / max / avg en el reporte final.
 */
const tiempoRespuesta = new Trend('tiempo_respuesta_login', true); // true → unidad ms

// =============================================================================
// DATOS PARAMETRIZADOS
// SharedArray parsea el CSV una sola vez en memoria y lo comparte entre todos
// los VUs, evitando múltiples lecturas de disco y reduciendo el footprint RAM.
// =============================================================================
const csvData = new SharedArray('usuarios', function () {
  const raw = open('../data/users.csv');

  // papaparse convierte el CSV en un array de objetos usando la primera fila
  // como clave → [{ user: 'donero', passwd: 'ewedon' }, ...]
  const parsed = papaparse.parse(raw, {
    header:     true,   // usa la fila 1 (user,passwd) como nombres de columna
    skipEmptyLines: true,
  });

  return parsed.data;
});

// =============================================================================
// OPCIONES DE LA PRUEBA
// =============================================================================
export const options = {

  // ---------------------------------------------------------------------------
  // ESCENARIO: ramping-arrival-rate
  // Controla la tasa de llegada (TPS) en lugar de la cantidad de VUs activos.
  // Esto simula carga realista independientemente del tiempo de respuesta del SUT.
  // ---------------------------------------------------------------------------
  scenarios: {
    login_scenario: {
      executor: 'ramping-arrival-rate',

      // Unidad de las "rates" en las stages (iteraciones POR SEGUNDO)
      timeUnit: '1s',

      // VUs preasignados al inicio (evita latencia de arranque)
      preAllocatedVUs: 50,

      // Techo de VUs que k6 puede crear si preAllocatedVUs se agotan
      maxVUs: 100,

      stages: [
        // Etapa 1 — ramp-up: 0 → 20 TPS en 30 s
        { duration: '30s', target: 20 },

        // Etapa 2 — steady: 25 TPS durante 2 min
        // Se usa 25 TPS (> 20) para garantizar que el umbral de ≥20 TPS se cumpla
        // con margen ante pequeñas variaciones del scheduler de k6.
        { duration: '2m',  target: 25 },

        // Etapa 3 — ramp-down: 25 → 0 TPS en 15 s
        { duration: '15s', target: 0  },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // THRESHOLDS — criterios de aceptación del ejercicio
  // Si alguno falla, k6 termina con exit code 99 (útil en pipelines CI/CD).
  // ---------------------------------------------------------------------------
  thresholds: {
    // P95 del tiempo de respuesta global debe estar por debajo de 1 500 ms
    'http_req_duration': ['p(95)<1500'],

    // Tasa de requests fallidos (status >= 400 o error de red) < 3 %
    'http_req_failed':   ['rate<0.03'],
  },
};

// =============================================================================
// CONFIGURACIÓN DEL ENDPOINT
// Centralizada aquí para facilitar cambios entre ambientes.
// =============================================================================
const BASE_URL = __ENV.BASE_URL || 'https://fakestoreapi.com';
const LOGIN_URL = `${BASE_URL}/auth/login`;

// Headers requeridos por la API — sin Content-Type la API rechaza el body JSON.
const HEADERS = { 'Content-Type': 'application/json' };

// =============================================================================
// FUNCIÓN PRINCIPAL (ejecutada por cada VU en cada iteración)
// =============================================================================
export default function loginTest() {

  // ---------------------------------------------------------------------------
  // SELECCIÓN DE USUARIO
  // __VU es el ID del VU actual (1-based). El módulo garantiza distribución
  // uniforme entre todos los usuarios del CSV sin importar cuántos VUs haya.
  // ---------------------------------------------------------------------------
  const usuario = csvData[(__VU - 1) % csvData.length];

  // ---------------------------------------------------------------------------
  // CONSTRUCCIÓN DE LA REQUEST
  // ---------------------------------------------------------------------------
  const payload = JSON.stringify({
    username: usuario.user,
    password: usuario.passwd,
  });

  const params = {
    headers: HEADERS,
    // Tag personalizado: permite filtrar métricas por endpoint en dashboards
    tags: { endpoint: 'login' },
  };

  // ---------------------------------------------------------------------------
  // ENVÍO DE LA REQUEST
  // ---------------------------------------------------------------------------
  const res = http.post(LOGIN_URL, payload, params);

  // ---------------------------------------------------------------------------
  // REGISTRO DE MÉTRICA CUSTOM DE TIEMPO
  // Se registra antes de los checks para capturar el dato siempre.
  // ---------------------------------------------------------------------------
  tiempoRespuesta.add(res.timings.duration);

  // ---------------------------------------------------------------------------
  // PARSEO DE RESPUESTA
  // Se hace una sola vez por iteración para reutilizarlo en múltiples checks.
  // ---------------------------------------------------------------------------
  let body = {};
  try {
    body = JSON.parse(res.body);
  } catch (e) {
    // Si el body no es JSON válido, body queda como objeto vacío.
    // El check de "contiene token" fallará correctamente.
    console.debug(`Body no es JSON válido: ${e.message}`);
  }

  // ---------------------------------------------------------------------------
  // VALIDACIONES (checks)
  // check() no detiene la iteración; registra pass/fail en las métricas
  // checks{} y retorna true sólo si TODOS los checks pasan.
  // ---------------------------------------------------------------------------
  const todosOk = check(res, {

    // 1. La API responde con HTTP 200 o 201 (ambos son éxito en esta API)
    'status es 200 o 201': (r) => r.status === 200 || r.status === 201,

    // 2. El body no debe estar vacío (string con contenido)
    'body no está vacío': (r) => r.body && r.body.length > 0,

    // 3. El body debe contener la clave "token" (respuesta exitosa de la API)
    'body contiene token': () => typeof body.token === 'string' && body.token.length > 0,

    // 4. El tiempo de respuesta debe ser menor a 1 500 ms (SLA del ejercicio)
    'tiempo de respuesta < 1500ms': (r) => r.timings.duration < 1500,
  });

  // ---------------------------------------------------------------------------
  // ACTUALIZACIÓN DE CONTADORES CUSTOM
  // Permite ver en el reporte cuántos logins tuvieron token vs cuántos fallaron.
  // ---------------------------------------------------------------------------
  if (todosOk) {
    loginExitosos.add(1);
  } else {
    loginFallidos.add(1);
  }
}

// =============================================================================
// HANDLE SUMMARY
// Se ejecuta UNA VEZ al finalizar toda la prueba.
// Genera el reporte en results/summary.json con las métricas clave.
// =============================================================================
export function handleSummary(data) {

  // ---------------------------------------------------------------------------
  // CÁLCULO DE MÉTRICAS DERIVADAS PARA EL REPORTE
  // ---------------------------------------------------------------------------

  // TPS alcanzado = total de iteraciones / duración total en segundos
  const totalIteraciones = data.metrics.iterations?.values?.count ?? 0;
  const duracionSegundos = (data.state.testRunDurationMs ?? 0) / 1000;
  const tpsAlcanzado     = duracionSegundos > 0
    ? (totalIteraciones / duracionSegundos).toFixed(2)
    : 0;

  // P95 del tiempo de respuesta HTTP global (ms)
  const p95 = data.metrics.http_req_duration?.values?.['p(95)']?.toFixed(2) ?? 'N/A';

  // Tasa de error (porcentaje)
  const tasaError       = data.metrics.http_req_failed?.values?.rate ?? 0;
  const tasaErrorPct    = (tasaError * 100).toFixed(2);

  // Totales de requests
  const totalRequests   = data.metrics.http_reqs?.values?.count ?? 0;
  const exitosos        = data.metrics.login_exitosos?.values?.count ?? 0;
  const fallidos        = data.metrics.login_fallidos?.values?.count ?? 0;

  // ---------------------------------------------------------------------------
  // OBJETO DE REPORTE FINAL
  // ---------------------------------------------------------------------------
  const resumen = {
    meta: {
      herramienta:  'k6 v0.54.0',
      proyecto:     'technical-test-pichincha-k6',
      endpoint:     'POST https://fakestoreapi.com/auth/login',
      fechaEjecucion: new Date().toISOString(),
    },
    resultado: {
      tpsAlcanzado:      Number.parseFloat(tpsAlcanzado),
      duracionSegundos:  Number.parseFloat(duracionSegundos.toFixed(2)),
      totalRequests:     totalRequests,
      loginExitosos:     exitosos,
      loginFallidos:     fallidos,
    },
    sla: {
      p95_ms:            Number.parseFloat(p95),
      umbralP95_ms:      1500,
      p95_cumple:        Number.parseFloat(p95) < 1500,
      tasaErrorPct:      Number.parseFloat(tasaErrorPct),
      umbralErrorPct:    3,
      error_cumple:      Number.parseFloat(tasaErrorPct) < 3,
    },
    metricas: {
      http_req_duration: {
        avg:  data.metrics.http_req_duration?.values?.avg?.toFixed(2),
        min:  data.metrics.http_req_duration?.values?.min?.toFixed(2),
        p50:  data.metrics.http_req_duration?.values?.['med']?.toFixed(2),
        p90:  data.metrics.http_req_duration?.values?.['p(90)']?.toFixed(2),
        p95:  data.metrics.http_req_duration?.values?.['p(95)']?.toFixed(2),
        p99:  data.metrics.http_req_duration?.values?.['p(99)']?.toFixed(2),
        max:  data.metrics.http_req_duration?.values?.max?.toFixed(2),
      },
      tiempo_respuesta_login: {
        avg:  data.metrics.tiempo_respuesta_login?.values?.avg?.toFixed(2),
        p95:  data.metrics.tiempo_respuesta_login?.values?.['p(95)']?.toFixed(2),
        max:  data.metrics.tiempo_respuesta_login?.values?.max?.toFixed(2),
      },
    },
  };

  // ---------------------------------------------------------------------------
  // SALIDAS: JSON para procesamiento + texto legible en consola
  // ---------------------------------------------------------------------------
  return {
    // Archivo JSON persistido en /results (ignorado por .gitignore)
    '../results/summary.json': JSON.stringify(resumen, null, 2),

    // Reporte estándar de k6 en stdout (tabla de métricas completa)
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
  };
}

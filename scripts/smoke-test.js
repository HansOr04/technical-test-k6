// =============================================================================
// smoke-test.js
// Smoke Test — POST /auth/login  |  FakeStore API
//
// Ejecutar este script ANTES de la prueba de carga para validar conectividad
// y credenciales.
//
// Comando:
//   k6 run scripts/smoke-test.js
//
// Propósito: verificar que el endpoint responde correctamente y que cada uno
// de los 5 usuarios del CSV puede autenticarse antes de lanzar la prueba de
// carga completa.
// =============================================================================

import http      from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import papaparse from 'https://jslib.k6.io/papaparse/5.1.1/index.js';

// =============================================================================
// DATOS PARAMETRIZADOS
// =============================================================================
const csvData = new SharedArray('usuarios', function () {
  const raw = open('../data/users.csv');
  const parsed = papaparse.parse(raw, {
    header:         true,
    skipEmptyLines: true,
  });
  return parsed.data;
});

// =============================================================================
// OPCIONES DEL SMOKE TEST
// 1 VU, 1 iteración — el loop interno recorre los 5 usuarios exactamente una
// vez y termina. maxDuration de 30 s actúa como timeout de seguridad.
//
// IMPORTANTE: usar 'iterations: 1' en lugar de 'duration' es crítico aquí.
// Con 'duration', k6 repetiría el loop de 5 usuarios durante 30 s completos
// (~10 veces), generando 50 peticiones en vez de 5 y distorsionando la tasa
// de error del threshold.
// =============================================================================
export const options = {
  vus:         1,
  iterations:  1,
  maxDuration: '30s',

  thresholds: {
    // 0 errores de red/HTTP permitidos antes de escalar a carga completa
    'http_req_failed': ['rate<0.01'],
  },
};

// =============================================================================
// CONFIGURACIÓN DEL ENDPOINT
// =============================================================================
const BASE_URL  = __ENV.BASE_URL || 'https://fakestoreapi.com';
const LOGIN_URL = `${BASE_URL}/auth/login`;
const HEADERS   = { 'Content-Type': 'application/json' };

// =============================================================================
// HELPERS
// =============================================================================

/** Parsea el body JSON de la respuesta; retorna {} si no es JSON válido. */
function parseBody(res) {
  try {
    return JSON.parse(res.body);
  } catch (_) {
    return {};
  }
}

/** Acción sugerida según el código de estado recibido. */
function accionSugerida(status) {
  return status === 401
    ? 'Credenciales incorrectas — verifica usuario/contraseña en data/users.csv'
    : 'Error de servidor o red — verifica conectividad y estado de la API';
}

/**
 * Prueba el login de un usuario y registra el resultado en consola.
 * Retorna true si todos los checks pasan, false en caso contrario.
 */
function probarUsuario(usuario) {
  const payload = JSON.stringify({ username: usuario.user, password: usuario.passwd });
  const res     = http.post(LOGIN_URL, payload, { headers: HEADERS });

  const body         = parseBody(res);
  const tiempoMs     = res.timings.duration;
  const tokenPresente = typeof body.token === 'string' && body.token.length > 0;
  const statusOk     = res.status === 200 || res.status === 201;

  const ok = check(res, {
    'status es 200 o 201':          (r) => r.status === 200 || r.status === 201,
    'token presente en respuesta':  ()  => tokenPresente,
    'tiempo de respuesta < 1500ms': (r) => r.timings.duration < 1500,
  });

  console.log(
    `[smoke] usuario="${usuario.user}" | ` +
    `status=${res.status} (${statusOk ? 'OK' : 'FALLO'}) | ` +
    `token=${tokenPresente ? 'SI' : 'NO'} | ` +
    `tiempo=${tiempoMs.toFixed(0)}ms`
  );

  if (!ok) {
    // El body completo distingue 401 (credenciales) de 5xx (servidor).
    const bodyRaw = res.body ? res.body.substring(0, 200) : '(vacío)';
    console.warn(
      `[WARNING] El usuario "${usuario.user}" FALLO el smoke test.\n` +
      `  status  : ${res.status}\n` +
      `  token   : ${tokenPresente ? 'presente' : 'ausente'}\n` +
      `  tiempo  : ${tiempoMs.toFixed(0)}ms\n` +
      `  body    : ${bodyRaw}\n` +
      `  Acción  : ${accionSugerida(res.status)}`
    );
  }

  return ok;
}

// =============================================================================
// FUNCIÓN PRINCIPAL
// Recorre todos los usuarios del CSV en una sola iteración.
// =============================================================================
export default function smokeTest() {
  for (const usuario of csvData) {
    probarUsuario(usuario);
  }
}

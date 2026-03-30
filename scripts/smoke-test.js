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
// 1 VU, duración 30 s — el loop interno recorre los 5 usuarios una vez y para.
// =============================================================================
export const options = {
  vus:      1,
  duration: '30s',

  thresholds: {
    // 0 errores permitidos: cualquier fallo detiene la prueba de carga
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
// FUNCIÓN PRINCIPAL
// Recorre todos los usuarios del CSV en una sola iteración.
// =============================================================================
export default function () {
  for (let i = 0; i < csvData.length; i++) {
    const usuario = csvData[i];

    // -------------------------------------------------------------------------
    // REQUEST
    // -------------------------------------------------------------------------
    const payload = JSON.stringify({
      username: usuario.user,
      password: usuario.passwd,
    });

    const res = http.post(LOGIN_URL, payload, { headers: HEADERS });

    // -------------------------------------------------------------------------
    // PARSEO DE RESPUESTA
    // -------------------------------------------------------------------------
    let body = {};
    try {
      body = JSON.parse(res.body);
    } catch (_) {
      // body no es JSON — el check de token fallará correctamente
    }

    const tiempoMs     = res.timings.duration;
    const tokenPresente = typeof body.token === 'string' && body.token.length > 0;

    // -------------------------------------------------------------------------
    // VALIDACIONES
    // -------------------------------------------------------------------------
    const ok = check(res, {
      'status es 200 o 201':         (r) => r.status === 200 || r.status === 201,
      'token presente en respuesta': ()  => tokenPresente,
      'tiempo de respuesta < 1500ms': (r) => r.timings.duration < 1500,
    });

    // -------------------------------------------------------------------------
    // LOGGING POR USUARIO
    // -------------------------------------------------------------------------
    const statusOk = res.status === 200 || res.status === 201;
    console.log(
      `[smoke] usuario="${usuario.user}" | ` +
      `status=${res.status} (${statusOk ? 'OK' : 'FALLO'}) | ` +
      `token=${tokenPresente ? 'SI' : 'NO'} | ` +
      `tiempo=${tiempoMs.toFixed(0)}ms`
    );

    if (!ok) {
      console.warn(
        `[WARNING] El usuario "${usuario.user}" FALLO el smoke test. ` +
        `status=${res.status} | token=${tokenPresente} | tiempo=${tiempoMs.toFixed(0)}ms. ` +
        `Revisar credenciales o conectividad antes de ejecutar la prueba de carga.`
      );
    }
  }
}

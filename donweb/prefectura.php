<?php
// Prefectura no responde a GitHub ni a Cloudflare, pero sí desde Argentina. Esta tarea corre en un
// hosting de Donweb (tarea programada, cada 30 minutos): baja la tabla de alturas y, si cambió, se la
// pasa al Action, que la guarda en fuentes/prefectura.json.
// El token de GitHub va en token.txt, al lado de este archivo. Instalación: ver donweb/LEEME.md.
$API = 'https://api.github.com/repos/domar-EL/widget-rio-parana';
$ARCHIVO = 'fuentes/prefectura.json';
date_default_timezone_set('America/Argentina/Buenos_Aires');
// El panel descarta la salida de las tareas programadas: todo, también los errores de PHP, va a prefectura.log.
ini_set('log_errors', '1');
ini_set('error_log', __DIR__ . '/prefectura.log');

function pedir($url, $opciones) {
    $c = curl_init($url);
    curl_setopt_array($c, $opciones + array(CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_USERAGENT => 'widget-rios'));
    $cuerpo = curl_exec($c);
    if ($cuerpo === false) fallar($url . ': ' . curl_error($c));
    return array(curl_getinfo($c, CURLINFO_HTTP_CODE), $cuerpo);
}
function anotar($mensaje) {
    file_put_contents(__DIR__ . '/prefectura.log', date('Y-m-d H:i') . " $mensaje\n", FILE_APPEND);
}
function fallar($mensaje) {
    anotar($mensaje);
    exit(1);
}

list($codigo, $pagina) = pedir('https://contenidosweb.prefecturanaval.gob.ar/alturas/', array());
if ($codigo != 200) fallar("Prefectura respondió $codigo");
// Todas las filas de la tabla (cada puerto con sus 12 columnas); el Action toma las que usan las tablas.
$todas = array();
$santaFe = null;
preg_match_all('#<tr[^>]*>(.*?)</tr>#s', $pagina, $filas);
foreach ($filas[1] as $tr) {
    preg_match_all('#<t[hd][^>]*>(.*?)</t[hd]>#s', $tr, $celdas);
    if (count($celdas[1]) < 12) continue;
    $c = array();
    foreach (array_slice($celdas[1], 0, 12) as $td) {
        $texto = html_entity_decode(preg_replace('/<[^>]+>/', ' ', $td), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $c[] = json_encode(trim(preg_replace('/[\s\x{A0}]+/u', ' ', $texto)), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
    if ($c[0] == '"Puerto"') continue;   // encabezado
    $todas[] = '[' . implode(', ', $c) . ']';
    if (array_slice($c, 0, 2) == array('"SANTA FE"', '"PARANA"')) $santaFe = end($todas);
}
if ($santaFe === null) fallar('Prefectura: no está la fila de Santa Fe');
$nuevo = '{"filas": [' . implode(', ', $todas) . ']}';

$token = @file_get_contents(__DIR__ . '/token.txt');
if (!$token) fallar('Falta token.txt');
$token = trim($token);
if (!preg_match('/^[A-Za-z0-9_]+$/', $token)) fallar('token.txt tiene que tener solo el token, en texto plano (no un documento de TextEdit)');
$encabezados = array('Authorization: Bearer ' . $token, 'X-GitHub-Api-Version: 2022-11-28');
list($codigo, $actual) = pedir("$API/contents/$ARCHIVO", array(CURLOPT_HTTPHEADER => array_merge($encabezados, array('Accept: application/vnd.github.raw'))));
if ($codigo == 200 && rtrim($actual, "\n") === $nuevo) exit(0);

list($codigo, $respuesta) = pedir("$API/actions/workflows/actualizar.yml/dispatches", array(
    CURLOPT_HTTPHEADER => array_merge($encabezados, array('Accept: application/vnd.github+json')),
    CURLOPT_POSTFIELDS => json_encode(array('ref' => 'main', 'inputs' => array('prefectura' => $nuevo))),
));
if ($codigo != 204) fallar("GitHub respondió $codigo: " . substr($respuesta, 0, 200));
anotar('subido: ' . count($todas) . " puertos; Santa Fe $santaFe");

# Santa Fe durante el día, desde un hosting de Donweb

Reemplaza a `mac/`, en un hosting compartido de Donweb (panel Ferozo), que está en Argentina y sí
llega a Prefectura. `prefectura.php` corre cada 30 minutos como tarea programada, baja la tabla de
alturas (todos los puertos) y, si cambió, se la pasa al Action, que la guarda en
`fuentes/prefectura.json`. Con eso, el widget de Santa Fe y las tablas del Paraná y del Uruguay
muestran el último registro del día y no solo la lectura de las 0:00.

No hay SSH ni `gh`: el script habla directo con la API de GitHub y todo se instala desde el panel.

## Dónde está instalado

Cuenta de hosting "Santa Fe" (la de santafe.com.ar). En el servidor, carpeta
`/home/USUARIO/storagedir/widget-rios/`, que no se sirve por la web:

- `prefectura.php`: este script.
- `token.txt`: el token de GitHub, en una sola línea. Fine-grained del usuario `domar-EL`, limitado al
  repo `widget-rio-parana`, con permiso de lectura en Contents y de lectura y escritura en Actions.
- `prefectura.log`: lo escribe el script cuando sube un dato o cuando algo falla.

## Instalar en otra cuenta

1. En el panel de hosting, **Mi Sitio Web → Administrador de archivos**: crear la carpeta
   `widget-rios` dentro de `storagedir` y subir `prefectura.php`.
2. Crear ahí `token.txt` con el token.
3. **Herramientas → Tareas programadas → Crear nuevo**: elegir "Cada media hora" y, como comando,
   `php /home/USUARIO/storagedir/widget-rios/prefectura.php`.

Límites del panel que cuestan tiempo si no se conocen:

- PHP solo puede leer `storagedir`, `public_html`, `tmp` y `tmpsite` (`open_basedir`). Un script en
  cualquier otra carpeta no corre y no deja ningún error: la tarea parece no hacer nada.
- El comando tiene que empezar con `php`, `curl`, `wget` o la ruta de un PHP de `/opt`; no acepta
  `;`, `|`, `(`, `)`, `\`, ni `php -d`. La salida se descarta, por eso el script escribe su registro.
- La frecuencia mínima es cada 5 minutos.

## Revisar

Abrir `prefectura.log` desde el Administrador de archivos. Cada dato nuevo deja una línea
`subido: N puertos; Santa Fe […]`; si el dato no cambió, la corrida no escribe nada. Los errores (Prefectura no responde,
falta el token, GitHub lo rechaza) también quedan ahí.

## Desinstalar

Borrar la tarea programada y la carpeta `storagedir/widget-rios`.

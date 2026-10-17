# Crear y revisar un borrador de configuración

Este configurador prepara un documento para revisar. **Personal, Proyecto y Consulta sólo generan borradores**: ninguno conecta una terminal, concede permisos ni activa aislamiento. `EXPORT` devuelve el documento; no aprueba ni aplica su contenido. No introduzcas contraseñas, tokens ni claves.

## Comenzar desde este checkout

Abre una terminal en el checkout que contiene esta guía. La versión del paquete por sí sola no identifica las funciones disponibles: varias ramas todavía declaran 0.1.13. Este cambio parte del PR #3 y añade ayuda al configurador; la vista humana y su recuperación se desarrollan en ramas separadas.

```sh
node scripts/configure.mjs --help
node scripts/configure.mjs detect --json
node scripts/configure.mjs wizard
```

Sin argumentos también se obtiene ayuda. La ayuda y `detect` devuelven JSON; `detect` describe capacidades del planificador, no descubre equipos ni comprueba conexiones. `wizard` necesita entrada y stderr conectados a una terminal. Sus preguntas, revisión e instrucciones finales van a stderr; stdout contiene un único objeto JSON. `review --human` es la excepción explícita que devuelve texto en stdout.

El asistente pide una etiqueta de equipo elegida por ti, un nombre de perfil único, modo, plataforma, carpeta e intención de privacidad. Usa etiquetas de 1 a 64 letras ASCII, dígitos, `_` o `-`, por ejemplo `local` y `revision`. No se descubren cuentas ni se escogen carpetas o permisos automáticamente.

Para una carpeta Linux escribe `/projects/example`. Para Windows escribe `C:\Projects\Example`. Son ejemplos: reemplázalos por tu elección. Deben ser rutas absolutas normalizadas, sin segmentos `..` y distintas de otras carpetas del borrador. La carpeta declarada no se inspecciona ni se verifica. La opción `--file`, en cambio, lee el archivo JSON explícitamente indicado y necesita una ruta absoluta del sistema donde se ejecuta Node.

Puedes corregir cada respuesta hasta tres intentos o escribir `:cancel`. Las opciones de privacidad sólo expresan intención futura. Al final revisa el documento y escribe exactamente `EXPORT` si quieres recibirlo; cancelar no devuelve un plan exitoso.

## Guardar sin sobrescribir en Bash / WSL

El siguiente bloque crea `draft.json` en la carpeta actual. `noclobber` impide sobrescribir un archivo existente. Las preguntas permanecen visibles porque sólo se redirige stdout. Si ya existe, elige otro nombre; no retires la protección para continuar.

```sh
(
  set -o noclobber
  node scripts/configure.mjs wizard > draft.json
)
```

Comprueba que el comando termina correctamente. Si cancelas o falla, el archivo puede contener un objeto de error, no un plan: consérvalo para diagnosticar o elige un nombre nuevo para repetir. No lo uses como configuración activa.

Revisa el archivo con su ruta absoluta:

```sh
node scripts/configure.mjs validate --file "$PWD/draft.json" --json
node scripts/configure.mjs review --file "$PWD/draft.json" --human
node scripts/configure.mjs profiles list --file "$PWD/draft.json" --json
```

Para duplicar un perfil, carga el borrador y guarda el resultado bajo otro nombre, manteniendo la protección:

```sh
(
  set -o noclobber
  node scripts/configure.mjs wizard --file "$PWD/draft.json" > draft-next.json
)
```

La copia pide un nombre y una carpeta distintos, reinicia capacidades a false y destino a local/local-preview. No modifica el archivo de origen. La validación confirma estructura e integridad del borrador, no aprobación, conexión ni disponibilidad de aislamiento.

Estos bloques de guardado son para Bash/WSL. En PowerShell puedes ejecutar ayuda y el asistente sin redirección; no reutilices los bloques Bash como si fueran sintaxis PowerShell.

## Checkout de prueba e instalación gestionada

Probar este checkout separado no actualiza una instalación gestionada ni demuestra qué versión está instalada. Esta mejora local todavía no es una release publicada. El actualizador admite releases numéricas publicadas o el canal experimental, no una rama ni un SHA. Cambiar el commit conservando la misma versión puede devolver `UPDATE_RELEASE_IDENTITY_CHANGED`: no republiques 0.1.13 para eludirlo.

Un archivo local sólo sirve para un nuevo root de diagnóstico (`diagnostic-only`), no para actualizar un root existente. El cliente MCP predeterminado sólo expone `terminal_status`; no hay un botón de actualización verificado que esta guía pueda recomendar. Las instrucciones de actualización deben proceder de una publicación nueva y verificada. Este flujo termina con un borrador revisable, no con una instalación o conexión lista.

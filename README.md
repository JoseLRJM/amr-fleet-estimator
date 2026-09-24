# Simulador de cantidad de AMR requeridos

Herramienta React + TypeScript para dimensionar una flota compartida de AMR con varios destinos.

## Ejecutar

```bash
npm install
npm run dev
```

Abrir http://127.0.0.1:5174. Para validar cambios: `npm test` y `npm run build`.

## Calculo

Cada destino puede recibir su demanda en viajes por turno o viajes por hora. El selector convierte el valor al cambiar de unidad para conservar aproximadamente el mismo flujo. Si se ingresan viajes por hora, el flujo permanece fijo al cambiar las horas efectivas y se recalculan los viajes por turno. Cada destino tambien tiene distancia de ida, tipo de viaje, levantamientos, giros y espera. En viajes de ida y vuelta se incluye la distancia de retorno. En viajes de solo ida no se incluye el reposicionamiento posterior.

Se calcula el flujo de cada destino como `viajes por turno / horas efectivas` o se usa directamente el valor de `viajes por hora`. El ciclo base es la suma de desplazamiento, levantamientos, giros y espera. El trafico incrementa solo el desplazamiento: `factor = 1 + (porcentaje por AMR adicional / 100) * (AMR de la flota - 1)`.

La carga requerida en AMR es la suma de `flujo * ciclo / 3600` de todos los destinos, multiplicada por el coeficiente de redundancia y dividida por la disponibilidad mecanica y la disponibilidad de bateria. Se busca la menor flota entera capaz de satisfacer su propia carga con el trafico que produce. Si la demora por AMR crece mas rapido que la capacidad, se indica saturacion.

La autonomia y el tiempo de carga consideran las horas efectivas de todos los turnos y la ventana libre del dia. La estimacion de cargadores toma el mayor valor entre la regla configurable de AMR por cargador, la necesidad de carga durante la operacion y la capacidad de recarga fuera de turno. Las horas y viajes diarios reflejan el numero de turnos; los turnos identicos no se suman como flotas independientes.

El reporte PDF incluye el resultado conjunto, la contribucion de cada destino, su demanda ingresada y los supuestos. Las configuraciones JSON anteriores con uno o varios destinos se pueden importar. Cada campo editable tiene un icono de ayuda con explicacion y ejemplo, disponible con el mouse, teclado o toque.

El modelo es una estimacion de flujo promedio. No resuelve picos por hora, conflictos geometrico-temporales en cruces ni asignacion individual de tareas o cargadores.

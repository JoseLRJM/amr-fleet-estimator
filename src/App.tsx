import { useId, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import { CircleHelp } from "lucide-react";
import {
  calculate, defaultInputs, nonnegative, normalizeInputs, validationError,
  type DemandUnit, type Destination, type Inputs, type TripType,
} from "./calculation";

const CRBT_LOGO_PATH = "/crbt-logo.png";
const format = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const format2 = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type HelpContent = { description: string; example: string };

const help = {
  shiftHours: { description: "Duracion completa de un turno, incluidos descansos y pausas.", example: "Un turno de 06:00 a 14:00 dura 8 h." },
  effectiveHours: { description: "Horas disponibles para completar viajes en cada turno, descontando pausas y otras actividades.", example: "En un turno de 8 h con 48 min no productivos quedan 7.2 h efectivas." },
  shifts: { description: "Cantidad de turnos iguales que opera la planta por dia. Se usa para demanda diaria y recarga.", example: "Dos turnos de 8 h significan 16 h de operacion programada." },
  availability: { description: "Porcentaje de tiempo en que cada AMR esta operativo por causas mecanicas o tecnicas; la carga de bateria se calcula aparte.", example: "90% significa 54 min disponibles por cada hora programada." },
  batteryHours: { description: "Autonomia de trabajo del AMR antes de necesitar una recarga.", example: "8 h permiten cubrir un turno de 7.2 h efectivas sin carga durante el turno." },
  chargeHours: { description: "Tiempo necesario para recargar un AMR. Afecta la disponibilidad y las estaciones de carga.", example: "1.5 h de carga pueden aprovecharse fuera del turno si hay suficiente ventana libre." },
  robotsPerCharger: { description: "Regla minima de capacidad de carga: un cargador por este numero de AMR. El calculo tambien revisa el tiempo disponible.", example: "Con 4 AMR por cargador, una flota de 8 requiere al menos 2 cargadores." },
  loadedSpeed: { description: "Velocidad media del AMR durante el trayecto de ida con carga.", example: "100 m a 0.8 m/s toman 125 s." },
  emptySpeed: { description: "Velocidad media durante el retorno sin carga. Solo se aplica a viajes de ida y vuelta.", example: "100 m a 1.2 m/s toman aproximadamente 83 s." },
  liftTime: { description: "Segundos por cada levantamiento registrado en un destino.", example: "4 levantamientos de 10 s agregan 40 s al ciclo." },
  turnTime: { description: "Segundos adicionales por cada giro registrado en un destino.", example: "6 giros de 4 s agregan 24 s al ciclo." },
  redundancyFactor: { description: "Multiplica la carga de trabajo para reservar capacidad operativa adicional, como en el Excel.", example: "1.20 agrega 20% sobre los AMR calculados antes del redondeo." },
  trafficPerRobot: { description: "Porcentaje de demora del desplazamiento por cada AMR adicional en la flota compartida.", example: "Con 4 AMR y 1%, los trayectos tardan 3% mas." },
  name: { description: "Nombre que identifica este flujo en el desglose, la configuracion y el reporte.", example: "Linea de ensamble A." },
  demandUnit: { description: "Selecciona la unidad en que conoces la demanda. Al cambiarla, el valor se convierte para mantener el flujo.", example: "120 viajes por turno de 8 h efectivas equivalen a 15 viajes por hora." },
  demandShift: { description: "Numero de viajes que debe atender este destino durante cada turno. Se divide entre las horas efectivas.", example: "120 viajes en 8 h efectivas requieren 15 viajes/h." },
  demandHour: { description: "Flujo requerido de este destino por hora efectiva. Permanece fijo al cambiar la duracion efectiva del turno.", example: "15 viajes/h durante 8 h efectivas son 120 viajes por turno." },
  tripType: { description: "Ida y vuelta incluye el regreso vacio; solo ida cuenta unicamente el trayecto de ida.", example: "100 m de ida y 100 m de retorno forman un viaje redondo de 200 m." },
  loadedDistance: { description: "Distancia recorrida con carga desde el origen hasta este destino.", example: "Del almacen a la linea hay 100 m de ida." },
  emptyDistance: { description: "Distancia de retorno sin carga para este destino.", example: "Si el regreso usa otro pasillo de 90 m, ingresa 90 m." },
  liftsPerTrip: { description: "Numero promedio de maniobras de elevacion en cada viaje a este destino.", example: "4 levantamientos a 10 s agregan 40 s." },
  turnsPerTrip: { description: "Numero promedio de giros o maniobras de esquina por viaje.", example: "6 giros a 4 s agregan 24 s." },
  bufferTime: { description: "Espera y margen adicional por viaje por peatones, equipo en movimiento u otras pausas.", example: "Ingresa 70 s si cada viaje acumula ese tiempo de espera." },
} satisfies Record<string, HelpContent>;

function HelpTip({ title, content }: { title: string; content: HelpContent }) {
  const id = useId();
  return (
    <span className="help-control">
      <button type="button" className="help-button" aria-label={`Ayuda: ${title}`} aria-describedby={id}
        onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.blur(); }}>
        <CircleHelp size={16} aria-hidden="true" />
      </button>
      <span id={id} className="help-popover" role="tooltip">
        <strong>{title}</strong>
        <span>{content.description}</span>
        <em>Ejemplo: {content.example}</em>
      </span>
    </span>
  );
}

function NumberField({ label, value, unit, step = 1, min = 0, onChange, content }: {
  label: string; value: number; unit?: string; step?: number; min?: number;
  onChange: (value: number) => void; content: HelpContent;
}) {
  const id = useId();
  return (
    <div className="field">
      <span className="field-label"><label htmlFor={id}>{label}</label><HelpTip title={label} content={content} /></span>
      <span className="input-shell">
        <input id={id} type="number" min={min} step={step} value={value}
          onChange={(event) => onChange(nonnegative(event.target.value))} />
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

function SelectField<T extends string>({ label, value, options, onChange, content }: {
  label: string; value: T; options: { value: T; label: string }[];
  onChange: (value: T) => void; content: HelpContent;
}) {
  const id = useId();
  return (
    <div className="field">
      <span className="field-label"><label htmlFor={id}>{label}</label><HelpTip title={label} content={content} /></span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><dt>{label}</dt><dd>{value}</dd></div>;
}

function downloadBlob(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function loadImageDataUrl(src: string) {
  const response = await fetch(src);
  if (!response.ok) throw new Error("Logo unavailable");
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export default function App() {
  const configFileRef = useRef<HTMLInputElement | null>(null);
  const [inputs, setInputs] = useState<Inputs>(defaultInputs);
  const [importStatus, setImportStatus] = useState("");
  const results = useMemo(() => calculate(inputs), [inputs]);
  const calculationWarning = validationError(inputs) ??
    (results ? null : "La demanda y la demora por AMR adicional saturan el flujo. Reduce el trafico o revisa las rutas.");
  const totalDemand = inputs.destinations.reduce((sum, route) =>
    sum + (route.demandUnit === "hour" ? route.demandValue * inputs.effectiveHours : route.demandValue), 0);

  const update = <K extends keyof Inputs>(key: K, value: Inputs[K]) =>
    setInputs((current) => ({ ...current, [key]: value }));
  const updateDestination = <K extends keyof Destination>(id: string, key: K, value: Destination[K]) =>
    setInputs((current) => ({
      ...current,
      destinations: current.destinations.map((route) => route.id === id ? { ...route, [key]: value } : route),
    }));
  const updateDemandUnit = (id: string, unit: DemandUnit) =>
    setInputs((current) => ({
      ...current,
      destinations: current.destinations.map((route) => {
        if (route.id !== id || route.demandUnit === unit) return route;
        if (current.effectiveHours <= 0) return { ...route, demandUnit: unit };
        const converted = unit === "hour"
          ? route.demandValue / current.effectiveHours
          : route.demandValue * current.effectiveHours;
        return { ...route, demandUnit: unit, demandValue: Number(converted.toFixed(unit === "hour" ? 3 : 2)) };
      }),
    }));
  const addDestination = () =>
    setInputs((current) => ({
      ...current,
      destinations: [...current.destinations, {
        ...defaultInputs.destinations[0],
        id: crypto.randomUUID(),
        name: `Destino ${current.destinations.length + 1}`,
        demandValue: 0,
      }],
    }));
  const removeDestination = (id: string) =>
    setInputs((current) => ({
      ...current,
      destinations: current.destinations.filter((route) => route.id !== id),
    }));

  const exportConfiguration = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadBlob(JSON.stringify({
      app: "amr-fleet-estimator", schemaVersion: 3, exportedAt: new Date().toISOString(), inputs, results,
    }, null, 2), `amr-robots-config-${timestamp}.json`);
  };
  const importConfiguration = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = parsed?.inputs ?? parsed;
      if (!imported || typeof imported !== "object" || Array.isArray(imported) ||
          (!Array.isArray(imported.destinations) && !("tripsPerShift" in imported))) {
        throw new Error("Invalid configuration");
      }
      setInputs(normalizeInputs(imported));
      setImportStatus(`Configuracion importada: ${file.name}`);
    } catch {
      setImportStatus("No se pudo importar. Selecciona una configuracion JSON del simulador.");
    } finally {
      if (configFileRef.current) configFileRef.current.value = "";
    }
  };
  const executiveSummary = results
    ? `Se requieren ${results.recommendedRobots} AMR para ${format.format(results.totalTripsPerShift)} viajes por turno en ${results.destinations.length} ${results.destinations.length === 1 ? "destino" : "destinos"}. El flujo conjunto es de ${format2.format(results.totalTripsHour)} viajes/h y la utilizacion calculada es ${format.format(results.utilizationPercent)}%. Se ${results.chargeStations === 1 ? "recomienda" : "recomiendan"} ${results.chargeStations} ${results.chargeStations === 1 ? "estacion" : "estaciones"} de carga. El factor de trafico con la flota propuesta es ${format2.format(results.trafficMultiplier)}x sobre el tiempo de desplazamiento.`
    : calculationWarning ?? "Configura los destinos para calcular la flota.";

  const downloadPdfReport = async () => {
    if (!results) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const pdf = new jsPDF({ unit: "mm", format: "letter" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 15;
    let y = 17;
    const ensureSpace = (height: number) => {
      if (y + height <= pageHeight - 16) return;
      pdf.addPage();
      pdf.setFillColor(229, 103, 0);
      pdf.rect(0, 0, pageWidth, 5, "F");
      y = 16;
    };
    const section = (title: string) => {
      ensureSpace(13);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.setTextColor(229, 103, 0);
      pdf.text(title, margin, y);
      y += 7;
    };
    const line = (label: string, value: string) => {
      pdf.setFontSize(8.5);
      const labelWidth = 63;
      const valueLines = pdf.splitTextToSize(value, pageWidth - margin * 2 - labelWidth);
      const labelLines = pdf.splitTextToSize(label, labelWidth - 3);
      const height = Math.max(labelLines.length, valueLines.length) * 4.5 + 2;
      ensureSpace(height);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(71, 85, 105);
      pdf.text(labelLines, margin, y);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(17, 24, 39);
      pdf.text(valueLines, margin + labelWidth, y);
      y += height;
    };
    pdf.setFillColor(229, 103, 0);
    pdf.rect(0, 0, pageWidth, 7, "F");
    try {
      pdf.addImage(await loadImageDataUrl(CRBT_LOGO_PATH), "PNG", margin, 12, 48, 23);
    } catch {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(22);
      pdf.setTextColor(229, 103, 0);
      pdf.text("CRBT", margin, 25);
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.setTextColor(17, 24, 39);
    pdf.text("Dimensionamiento de flota AMR", margin + 57, 23);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(71, 85, 105);
    pdf.text(new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date()), margin + 57, 30);
    pdf.setDrawColor(203, 213, 225);
    pdf.line(margin, 41, pageWidth - margin, 41);
    y = 51;

    section("Resultados de la flota");
    line("Robots recomendados", `${results.recommendedRobots} AMR`);
    line("Robots sin redondear", format2.format(results.minimumRobots));
    line("Estaciones de carga", String(results.chargeStations));
    line("Demanda conjunta", `${format2.format(results.totalTripsHour)} viajes/h`);
    line("Demanda diaria", `${format.format(results.totalTripsPerDay)} viajes en ${inputs.shifts} turno(s)`);
    line("Utilizacion", `${format2.format(results.utilizationPercent)}%`);
    line("Factor de trafico resultante", `${format2.format(results.trafficMultiplier)}x en desplazamientos`);

    section("Calculo por destino");
    results.destinations.forEach((route, index) => {
      ensureSpace(34);
      line(`Destino ${index + 1}`, route.name || `Destino ${index + 1}`);
      line("Demanda ingresada", `${format2.format(route.demandValue)} viajes/${route.demandUnit === "hour" ? "h" : "turno"}`);
      line("Flujo", `${format2.format(route.tripsHour)} viajes/h (${format.format(route.tripsPerShift)} por turno)`);
      line("Recorrido", `${route.tripType === "roundTrip" ? "Ida y vuelta" : "Solo ida"}; ida ${format.format(route.loadedDistance)} m${route.tripType === "roundTrip" ? `, retorno ${format.format(route.emptyDistance)} m` : ""}`);
      line("Eventos y margen", `${format.format(route.liftsPerTrip)} levantamientos, ${format.format(route.turnsPerTrip)} giros, ${format.format(route.bufferTime)} s de espera`);
      line("Ciclo / carga", `${format2.format(route.cycleSeconds)} s; ${format2.format(route.robotsAtFleetTraffic)} AMR equivalentes`);
    });
    section("Supuestos de operacion");
    line("Turnos", `${inputs.shifts} x ${format2.format(inputs.shiftHours)} h; ${format2.format(inputs.effectiveHours)} h efectivas por turno`);
    line("Velocidades", `${format2.format(inputs.loadedSpeed)} m/s cargado; ${format2.format(inputs.emptySpeed)} m/s vacio`);
    line("Levantamiento / giro", `${format.format(inputs.liftTime)} s / ${format.format(inputs.turnTime)} s por evento`);
    line("Disponibilidad / bateria", `${format.format(inputs.availability)}% mecanica; ${format2.format(inputs.batteryHours)} h autonomia / ${format2.format(inputs.chargeHours)} h carga`);
    line("Redundancia / trafico", `${format2.format(inputs.redundancyFactor)}x; ${format2.format(inputs.trafficPerRobot)}% mas tiempo de viaje por AMR adicional`);
    line("Cargadores", `Al menos 1 por cada ${inputs.robotsPerCharger} AMR y los necesarios segun carga en operacion o fuera de turno.`);
    line("Metodo", "Se suman flujos x ciclos por destino. El trafico afecta el viaje segun el tamano de la flota. El viaje simple no incluye reposicionamiento.");
    line("Validacion", "Estimacion preliminar; confirmar layout, rutas compartidas, picos y politica de carga en sitio.");

    const pages = pdf.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      pdf.setPage(page);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.setTextColor(100, 116, 139);
      pdf.text("CRBT Robots Moviles | Simulador de cantidad de AMR", margin, pageHeight - 8);
      pdf.text(`${page} / ${pages}`, pageWidth - margin, pageHeight - 8, { align: "right" });
    }
    pdf.save(`amr-robots-report-${timestamp}.pdf`);
  };

  return (
    <main className="page">
      <header className="app-header">
        <img src={CRBT_LOGO_PATH} alt="CRBT Robots Moviles" />
        <div className="header-copy">
          <p className="eyebrow">Planeacion de flota</p>
          <h1>Simulador de cantidad de AMR requeridos</h1>
        </div>
        <input ref={configFileRef} accept="application/json,.json" className="hidden-file" type="file"
          onChange={(event) => void importConfiguration(event.target.files?.[0])} />
        <div className="report-actions">
          <button type="button" onClick={exportConfiguration}>Descargar configuracion</button>
          <button type="button" onClick={() => void downloadPdfReport()} disabled={!results}>Descargar reporte</button>
          <button type="button" onClick={() => configFileRef.current?.click()}>Importar configuracion</button>
        </div>
      </header>
      {importStatus && <p className="import-status" role="status">{importStatus}</p>}

      <div className="simulator">
        <div className="configuration">
          <section className="form-section">
            <div className="section-heading"><h2>Jornada y flota</h2></div>
            <div className="form-grid">
              <NumberField label="Duracion del turno" content={help.shiftHours} value={inputs.shiftHours} unit="h" step={0.1} onChange={(value) => update("shiftHours", value)} />
              <NumberField label="Horas efectivas por turno" content={help.effectiveHours} value={inputs.effectiveHours} unit="h" step={0.1} onChange={(value) => update("effectiveHours", value)} />
              <NumberField label="Turnos por dia" content={help.shifts} value={inputs.shifts} onChange={(value) => update("shifts", value)} />
              <NumberField label="Disponibilidad mecanica" content={help.availability} value={inputs.availability} unit="%" onChange={(value) => update("availability", Math.min(100, value))} />
              <NumberField label="Autonomia de bateria" content={help.batteryHours} value={inputs.batteryHours} unit="h" step={0.1} onChange={(value) => update("batteryHours", value)} />
              <NumberField label="Tiempo de carga" content={help.chargeHours} value={inputs.chargeHours} unit="h" step={0.1} onChange={(value) => update("chargeHours", value)} />
              <NumberField label="AMR por cargador" content={help.robotsPerCharger} value={inputs.robotsPerCharger} onChange={(value) => update("robotsPerCharger", value)} />
            </div>
          </section>
          <section className="form-section">
            <div className="section-heading"><h2>Movimiento y factores</h2></div>
            <div className="form-grid">
              <NumberField label="Velocidad cargado" content={help.loadedSpeed} value={inputs.loadedSpeed} unit="m/s" step={0.1} onChange={(value) => update("loadedSpeed", value)} />
              <NumberField label="Velocidad vacio" content={help.emptySpeed} value={inputs.emptySpeed} unit="m/s" step={0.1} onChange={(value) => update("emptySpeed", value)} />
              <NumberField label="Tiempo por levantamiento" content={help.liftTime} value={inputs.liftTime} unit="s" onChange={(value) => update("liftTime", value)} />
              <NumberField label="Tiempo por giro" content={help.turnTime} value={inputs.turnTime} unit="s" onChange={(value) => update("turnTime", value)} />
              <NumberField label="Coeficiente de redundancia" content={help.redundancyFactor} value={inputs.redundancyFactor} unit="x" step={0.05} min={1} onChange={(value) => update("redundancyFactor", value)} />
              <NumberField label="Demora por AMR adicional" content={help.trafficPerRobot} value={inputs.trafficPerRobot} unit="%" step={0.1} onChange={(value) => update("trafficPerRobot", value)} />
            </div>
            <p className="field-note">El trafico aumenta el tiempo de viaje con la flota total. Los tiempos de servicio no cambian.</p>
          </section>
          <section className="destinations-section">
            <div className="section-heading">
              <div><h2>Destinos</h2><p>{inputs.destinations.length} {inputs.destinations.length === 1 ? "ruta" : "rutas"} · {format.format(totalDemand)} viajes por turno</p></div>
              <button className="primary-button" type="button" onClick={addDestination}>+ Agregar destino</button>
            </div>
            {inputs.destinations.map((route, index) => {
              const routeResult = results?.destinations[index];
              return (
                <article className="destination" key={route.id}>
                  <div className="destination-heading">
                    <span className="destination-index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="destination-name-wrap">
                      <input aria-label={`Nombre del destino ${index + 1}`} className="destination-name" value={route.name}
                        onChange={(event) => updateDestination(route.id, "name", event.target.value)} />
                      <HelpTip title="Nombre del destino" content={help.name} />
                    </span>
                    <button className="remove-button" type="button" onClick={() => removeDestination(route.id)}
                      aria-label={`Eliminar ${route.name || `destino ${index + 1}`}`} title="Eliminar destino">Eliminar</button>
                  </div>
                  <div className="destination-fields">
                    <SelectField<DemandUnit> label="Unidad de demanda" content={help.demandUnit} value={route.demandUnit}
                      options={[{ value: "shift", label: "Viajes por turno" }, { value: "hour", label: "Viajes por hora" }]}
                      onChange={(value) => updateDemandUnit(route.id, value)} />
                    <NumberField label={route.demandUnit === "hour" ? "Viajes por hora" : "Viajes por turno"}
                      content={route.demandUnit === "hour" ? help.demandHour : help.demandShift}
                      value={route.demandValue} step={route.demandUnit === "hour" ? 0.01 : 1}
                      onChange={(value) => updateDestination(route.id, "demandValue", value)} />
                    <SelectField<TripType> label="Tipo de viaje" content={help.tripType} value={route.tripType}
                      options={[{ value: "roundTrip", label: "Ida y vuelta" }, { value: "simple", label: "Solo ida" }]}
                      onChange={(value) => updateDestination(route.id, "tripType", value)} />
                    <NumberField label="Distancia de ida" content={help.loadedDistance} value={route.loadedDistance} unit="m" onChange={(value) => updateDestination(route.id, "loadedDistance", value)} />
                    {route.tripType === "roundTrip" && <NumberField label="Distancia de retorno" content={help.emptyDistance} value={route.emptyDistance} unit="m" onChange={(value) => updateDestination(route.id, "emptyDistance", value)} />}
                    <NumberField label="Levantamientos por viaje" content={help.liftsPerTrip} value={route.liftsPerTrip} onChange={(value) => updateDestination(route.id, "liftsPerTrip", value)} />
                    <NumberField label="Giros por viaje" content={help.turnsPerTrip} value={route.turnsPerTrip} onChange={(value) => updateDestination(route.id, "turnsPerTrip", value)} />
                    <NumberField label="Espera y margen por viaje" content={help.bufferTime} value={route.bufferTime} unit="s" onChange={(value) => updateDestination(route.id, "bufferTime", value)} />
                  </div>
                  {route.tripType === "simple" && <p className="field-note">Solo ida: el reposicionamiento posterior no forma parte de este ciclo.</p>}
                  {routeResult && <div className="destination-result">
                    <span><b>{format2.format(routeResult.tripsHour)}</b> viajes/h</span>
                    <span><b>{format2.format(routeResult.cycleSeconds)}</b> s/ciclo</span>
                    <span><b>{format2.format(routeResult.robotsAtFleetTraffic)}</b> AMR equivalentes</span>
                  </div>}
                </article>
              );
            })}
          </section>
        </div>
        <aside className="results-panel">
          <div className="result-hero">
            <span>Flota recomendada</span>
            <strong>{results ? results.recommendedRobots : "—"}</strong>
            <small>AMR</small>
            <div className="result-secondary">
              <span><b>{results ? results.chargeStations : "—"}</b> {results?.chargeStations === 1 ? "cargador" : "cargadores"}</span>
              <span><b>{results ? format2.format(results.minimumRobots) : "—"}</b> sin redondear</span>
            </div>
          </div>
          {calculationWarning && <div className="warning" role="alert">{calculationWarning}</div>}
          {results && <>
            <div className="util-section">
              <div className="util-heading"><span>Utilizacion de flota</span><strong>{format2.format(results.utilizationPercent)}%</strong></div>
              <div className="util-bar"><span style={{ width: `${Math.min(100, results.utilizationPercent)}%` }} /></div>
            </div>
            <dl className="metrics">
              <Metric label="Flujo total" value={`${format2.format(results.totalTripsHour)} viajes/h`} />
              <Metric label="Viajes por dia" value={format.format(results.totalTripsPerDay)} />
              <Metric label="Ciclo medio ponderado" value={`${format2.format(results.weightedCycleSeconds)} s`} />
              <Metric label="Factor de trafico" value={`${format2.format(results.trafficMultiplier)}x`} />
              <Metric label="Disponibilidad con carga" value={`${format2.format(results.effectiveAvailability * 100)}%`} />
              <Metric label="Carga total de trabajo" value={`${format2.format(results.requiredRobotHoursPerHour)} AMR`} />
              <Metric label="Margen de flota" value={`${format2.format(results.capacityMarginRobotHours)} AMR`} />
              <Metric label="Horas AMR por dia" value={format2.format(results.dailyRobotHours)} />
            </dl>
            <section className="breakdown">
              <h2>Contribucion por destino</h2>
              {results.destinations.map((route) => <div key={route.id} className="breakdown-row">
                <div><strong>{route.name || "Sin nombre"}</strong><small>{format2.format(route.tripsHour)} viajes/h · {route.tripType === "roundTrip" ? "Ida y vuelta" : "Solo ida"}</small></div>
                <b>{format2.format(route.robotsAtFleetTraffic)} AMR</b>
              </div>)}
            </section>
          </>}
          <section className="summary"><h2>Resumen</h2><p>{executiveSummary}</p></section>
          <p className="note">Estimacion preliminar. Validar rutas compartidas, picos de demanda y politica de carga en sitio.</p>
        </aside>
      </div>
    </main>
  );
}

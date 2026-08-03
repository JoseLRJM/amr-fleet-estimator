import { useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";

type Level = "low" | "medium" | "high";
type TripType = "simple" | "roundTrip";

type Inputs = {
  tripsPerShift: number;
  shiftHours: number;
  effectiveHours: number;
  shifts: number;
  loadedDistance: number;
  emptyDistance: number;
  tripType: TripType;
  pickupTime: number;
  deliveryTime: number;
  maneuverTime: number;
  waitTime: number;
  loadedSpeed: number;
  emptySpeed: number;
  availability: number;
  batteryHours: number;
  chargeHours: number;
  traffic: Level;
  crossings: Level;
  complexity: Level;
};

const CRBT_LOGO_PATH = "/crbt-logo.png";

const defaultInputs: Inputs = {
  tripsPerShift: 120,
  shiftHours: 8,
  effectiveHours: 7.2,
  shifts: 1,
  loadedDistance: 100,
  emptyDistance: 100,
  tripType: "roundTrip",
  pickupTime: 30,
  deliveryTime: 30,
  maneuverTime: 20,
  waitTime: 20,
  loadedSpeed: 0.8,
  emptySpeed: 1.2,
  availability: 90,
  batteryHours: 8,
  chargeHours: 1.5,
  traffic: "medium",
  crossings: "medium",
  complexity: "medium",
};

const factors = {
  traffic: { low: 1.1, medium: 1.2, high: 1.35 },
  crossings: { low: 1.05, medium: 1.1, high: 1.2 },
  complexity: { low: 1.05, medium: 1.15, high: 1.3 },
};

const labels = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
};

const format = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const format2 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });
const clampNumber = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);
const safeFilePart = (value: string) => value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();

const downloadBlob = (content: BlobPart | Blob, filename: string, mimeType: string) => {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const loadImageDataUrl = async (src: string) => {
  const response = await fetch(src);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
};

function calculate(inputs: Inputs) {
  const invalid =
    inputs.tripsPerShift <= 0 ||
    inputs.effectiveHours <= 0 ||
    inputs.loadedSpeed <= 0 ||
    inputs.emptySpeed <= 0 ||
    inputs.availability <= 0;

  if (invalid) return null;

  // Central formula:
  // adjusted cycle time = travel time + service times, multiplied by environment factors.
  // robot capacity = 3600 / adjusted cycle time * availability.
  // recommended robots = ceil(required trips per hour / robot capacity).
  const emptyDistance = inputs.tripType === "simple" ? 0 : inputs.emptyDistance;
  const loadedTravel = inputs.loadedDistance / inputs.loadedSpeed;
  const emptyTravel = emptyDistance / inputs.emptySpeed;
  const baseCycle =
    loadedTravel + emptyTravel + inputs.pickupTime + inputs.deliveryTime + inputs.maneuverTime + inputs.waitTime;
  const environmentFactor =
    factors.traffic[inputs.traffic] * factors.crossings[inputs.crossings] * factors.complexity[inputs.complexity];
  const adjustedCycle = baseCycle * environmentFactor;
  const cycleMinutes = adjustedCycle / 60;
  const tripsHourRobotBase = 3600 / adjustedCycle;
  const tripsHourRobotReal = tripsHourRobotBase * (inputs.availability / 100);
  const tripsHourRequired = inputs.tripsPerShift / inputs.effectiveHours;
  const minimumRobots = tripsHourRequired / tripsHourRobotReal;
  const recommendedRobots = Math.max(1, Math.ceil(minimumRobots));
  const installedCapacityHour = recommendedRobots * tripsHourRobotReal;
  const utilization = tripsHourRequired / installedCapacityHour;
  const capacityMargin = installedCapacityHour - tripsHourRequired;
  const tripsShiftPerRobot = tripsHourRobotReal * inputs.effectiveHours;
  const totalShiftCapacity = tripsShiftPerRobot * recommendedRobots;

  return {
    loadedTravel,
    emptyTravel,
    baseCycle,
    environmentFactor,
    adjustedCycle,
    cycleMinutes,
    tripsHourRobotReal,
    tripsHourRequired,
    minimumRobots,
    recommendedRobots,
    installedCapacityHour,
    utilization,
    utilizationPercent: utilization * 100,
    capacityMargin,
    tripsShiftPerRobot,
    totalShiftCapacity,
  };
}

function utilizationState(percent: number) {
  if (percent <= 70) {
    return {
      key: "loose",
      title: "Operacion holgada",
      message: "La operacion cuenta con margen operativo suficiente.",
    };
  }
  if (percent <= 85) {
    return {
      key: "balanced",
      title: "Operacion balanceada",
      message: "La operacion se encuentra en un rango adecuado de utilizacion.",
    };
  }
  if (percent <= 95) {
    return {
      key: "tight",
      title: "Operacion ajustada",
      message: "La operacion es viable, pero con poco margen ante trafico, esperas o picos de demanda.",
    };
  }
  return {
    key: "risk",
    title: "Riesgo de saturacion",
    message: "Se recomienda agregar capacidad adicional o revisar tiempos de ciclo.",
  };
}

const normalizeInputs = (rawInputs: unknown): Inputs => {
  const imported = rawInputs as Partial<Inputs>;
  const level = (value: unknown): Level => (value === "low" || value === "medium" || value === "high" ? value : "medium");
  const tripType: TripType = imported.tripType === "simple" || imported.tripType === "roundTrip" ? imported.tripType : "roundTrip";
  return {
    tripsPerShift: clampNumber(Number(imported.tripsPerShift ?? defaultInputs.tripsPerShift)),
    shiftHours: clampNumber(Number(imported.shiftHours ?? defaultInputs.shiftHours)),
    effectiveHours: clampNumber(Number(imported.effectiveHours ?? defaultInputs.effectiveHours)),
    shifts: clampNumber(Number(imported.shifts ?? defaultInputs.shifts)),
    loadedDistance: clampNumber(Number(imported.loadedDistance ?? defaultInputs.loadedDistance)),
    emptyDistance: clampNumber(Number(imported.emptyDistance ?? defaultInputs.emptyDistance)),
    tripType,
    pickupTime: clampNumber(Number(imported.pickupTime ?? defaultInputs.pickupTime)),
    deliveryTime: clampNumber(Number(imported.deliveryTime ?? defaultInputs.deliveryTime)),
    maneuverTime: clampNumber(Number(imported.maneuverTime ?? defaultInputs.maneuverTime)),
    waitTime: clampNumber(Number(imported.waitTime ?? defaultInputs.waitTime)),
    loadedSpeed: clampNumber(Number(imported.loadedSpeed ?? defaultInputs.loadedSpeed)),
    emptySpeed: clampNumber(Number(imported.emptySpeed ?? defaultInputs.emptySpeed)),
    availability: Math.min(100, clampNumber(Number(imported.availability ?? defaultInputs.availability))),
    batteryHours: clampNumber(Number(imported.batteryHours ?? defaultInputs.batteryHours)),
    chargeHours: clampNumber(Number(imported.chargeHours ?? defaultInputs.chargeHours)),
    traffic: level(imported.traffic),
    crossings: level(imported.crossings),
    complexity: level(imported.complexity),
  };
};

function NumberField({
  label,
  value,
  unit,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  unit?: string;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-shell">
        <input
          min={0}
          step={step}
          type="number"
          value={value}
          onChange={(event) => onChange(clampNumber(Number(event.target.value)))}
        />
        {unit && <small>{unit}</small>}
      </div>
    </label>
  );
}

function SliderField({
  label,
  value,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider-field">
      <span>
        {label}
        <strong>
          {format.format(value)} {unit}
        </strong>
      </span>
      <input min={0} max={max} type="range" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function LevelChips({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Level;
  onChange: (value: Level) => void;
}) {
  return (
    <div className="chip-group">
      <span>{label}</span>
      <div>
        {(["low", "medium", "high"] as Level[]).map((level) => (
          <button key={level} className={value === level ? "chip active" : "chip"} type="button" onClick={() => onChange(level)}>
            {labels[level]}
          </button>
        ))}
      </div>
    </div>
  );
}

function RobotIcons({ count, hasReserve }: { count: number; hasReserve: boolean }) {
  return (
    <div className="robot-icons">
      {Array.from({ length: Math.min(count, 12) }, (_, index) => (
        <div key={index} className={hasReserve && index === count - 1 ? "robot-icon reserve" : "robot-icon"} title={hasReserve && index === count - 1 ? "Reserva operativa" : "Robot operativo"}>
          <span />
          <i />
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const configFileRef = useRef<HTMLInputElement | null>(null);
  const [inputs, setInputs] = useState(defaultInputs);
  const [importStatus, setImportStatus] = useState("");
  const results = useMemo(() => calculate(inputs), [inputs]);
  const status = results ? utilizationState(results.utilizationPercent) : null;
  const hasReserve = results ? results.recommendedRobots > Math.ceil(Math.floor(results.minimumRobots)) : false;

  const update = <K extends keyof Inputs>(key: K, value: Inputs[K]) => {
    setInputs((current) => ({ ...current, [key]: value }));
  };

  const executiveSummary = results
    ? `Para una demanda de ${format.format(inputs.tripsPerShift)} viajes por turno, con una distancia promedio cargada de ${format.format(inputs.loadedDistance)} m, una distancia de retorno de ${format.format(inputs.tripType === "simple" ? 0 : inputs.emptyDistance)} m y una disponibilidad operativa del ${format.format(inputs.availability)}%, se estima una necesidad de ${results.recommendedRobots} robots moviles. El tiempo de ciclo estimado es de ${format.format(results.cycleMinutes)} minutos por viaje, con una capacidad aproximada de ${format.format(results.tripsHourRobotReal)} viajes por hora por robot. La utilizacion estimada del sistema seria de ${format.format(results.utilizationPercent)}%. Esta estimacion es preliminar y debe validarse con layout, trafico real, estaciones, seguridad y pruebas en sitio.`
    : "Ingresa valores mayores a cero para calcular la estimacion.";

  const buildConfigurationExport = () => ({
    app: "amr-fleet-estimator",
    version: "0.1.0",
    exportedAt: new Date().toISOString(),
    units: {
      distance: "m",
      speed: "m/s",
      time: "s/h",
    },
    inputs,
    results,
  });

  const downloadConfiguration = () => {
    const timestamp = safeFilePart(new Date().toISOString());
    downloadBlob(
      JSON.stringify(buildConfigurationExport(), null, 2),
      `amr-robots-config-${timestamp}.json`,
      "application/json"
    );
  };

  const importConfiguration = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const importedInputs = parsed?.inputs ?? parsed;
        setInputs(normalizeInputs(importedInputs));
        setImportStatus(`Configuracion importada: ${file.name}`);
      } catch {
        setImportStatus("No se pudo importar la configuracion. Verifica que sea un JSON valido.");
      } finally {
        if (configFileRef.current) configFileRef.current.value = "";
      }
    };
    reader.onerror = () => {
      setImportStatus("No se pudo leer el archivo de configuracion.");
      if (configFileRef.current) configFileRef.current.value = "";
    };
    reader.readAsText(file);
  };

  const downloadPdfReport = async () => {
    if (!results) return;
    const timestamp = safeFilePart(new Date().toISOString());
    const pdf = new jsPDF({ unit: "mm", format: "letter" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 14;
    const contentWidth = pageWidth - margin * 2;
    let y = 18;

    pdf.setFillColor(229, 103, 0);
    pdf.rect(0, 0, pageWidth, 8, "F");
    try {
      const logo = await loadImageDataUrl(CRBT_LOGO_PATH);
      pdf.addImage(logo, "PNG", margin, 14, 56, 27);
    } catch {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(24);
      pdf.setTextColor(229, 103, 0);
      pdf.text("CRBT", margin, 29);
    }

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(18);
    pdf.setTextColor(17, 24, 39);
    pdf.text("Reporte de simulacion AMR", margin + 64, 24);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(71, 85, 105);
    pdf.text(`Generado: ${new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date())}`, margin + 64, 31);
    pdf.setDrawColor(203, 213, 225);
    pdf.line(margin, 46, pageWidth - margin, 46);
    y = 56;

    const ensureSpace = (height: number) => {
      if (y + height <= pageHeight - margin) return;
      pdf.addPage();
      y = margin + 4;
    };
    const section = (title: string) => {
      ensureSpace(12);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.setTextColor(229, 103, 0);
      pdf.text(title, margin, y);
      y += 7;
    };
    const line = (label: string, value: string) => {
      ensureSpace(7);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8.5);
      pdf.setTextColor(71, 85, 105);
      pdf.text(`${label}:`, margin, y);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(17, 24, 39);
      const wrapped = pdf.splitTextToSize(value, contentWidth - 62);
      pdf.text(wrapped, margin + 62, y);
      y += Math.max(6, wrapped.length * 4.6);
    };

    section("Resultados principales");
    line("Robots recomendados", `${results.recommendedRobots} AMR`);
    line("Robots minimos calculados", format2.format(results.minimumRobots));
    line("Utilizacion estimada", `${format.format(results.utilizationPercent)}%`);
    line("Tiempo de ciclo", `${format.format(results.cycleMinutes)} min`);
    line("Viajes/h por robot", format.format(results.tripsHourRobotReal));
    line("Capacidad instalada/h", format.format(results.installedCapacityHour));
    line("Margen de capacidad", `${format.format(results.capacityMargin)} viajes/h`);

    section("Resumen ejecutivo");
    line("Conclusiones", executiveSummary);

    section("Configuracion usada");
    line("Viajes por turno", format.format(inputs.tripsPerShift));
    line("Horas efectivas", `${format.format(inputs.effectiveHours)} h`);
    line("Turnos", format.format(inputs.shifts));
    line("Distancia cargado", `${format.format(inputs.loadedDistance)} m`);
    line("Distancia vacio", `${format.format(inputs.tripType === "simple" ? 0 : inputs.emptyDistance)} m`);
    line("Tipo de recorrido", inputs.tripType === "simple" ? "Simple" : "Ida y vuelta");
    line("Tiempos de servicio", `Recoleccion ${format.format(inputs.pickupTime)} s, entrega ${format.format(inputs.deliveryTime)} s, maniobra ${format.format(inputs.maneuverTime)} s, espera ${format.format(inputs.waitTime)} s`);
    line("Velocidades", `Cargado ${format.format(inputs.loadedSpeed)} m/s, vacio ${format.format(inputs.emptySpeed)} m/s`);
    line("Disponibilidad", `${format.format(inputs.availability)}%`);
    line("Entorno", `Trafico ${labels[inputs.traffic]}, cruces ${labels[inputs.crossings]}, complejidad ${labels[inputs.complexity]}`);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    pdf.text("CRBT Robots Moviles - Estimacion preliminar sujeta a validacion de layout y pruebas en sitio.", margin, pageHeight - 8);
    pdf.save(`amr-robots-report-${timestamp}.pdf`);
  };

  return (
    <main className="page">
      <section className="hero">
        <img src={CRBT_LOGO_PATH} alt="CRBT Robots Moviles" />
        <div>
          <p className="eyebrow">Diagnostico preliminar AMR</p>
          <h1>Simulador de cantidad de AMR requeridos</h1>
          <p>
            Estima de forma visual cuantos robots moviles necesita una operacion industrial segun demanda, ruta,
            tiempos de ciclo y condiciones del entorno.
          </p>
          <input
            ref={configFileRef}
            accept="application/json,.json"
            className="hidden-file"
            type="file"
            onChange={(event) => importConfiguration(event.target.files?.[0])}
          />
          <div className="report-actions">
            <button type="button" onClick={downloadConfiguration}>
              Descargar configuracion
            </button>
            <button type="button" onClick={downloadPdfReport} disabled={!results}>
              Descargar reporte
            </button>
            <button type="button" onClick={() => configFileRef.current?.click()}>
              Importar configuracion
            </button>
          </div>
          {importStatus && <p className="import-status">{importStatus}</p>}
        </div>
      </section>

      <section className="simulator">
        <form className="panel form-panel">
          <section className="form-section">
            <h2>Demanda de operacion</h2>
            <NumberField label="Viajes por turno" value={inputs.tripsPerShift} onChange={(value) => update("tripsPerShift", value)} />
            <NumberField label="Duracion del turno" value={inputs.shiftHours} unit="h" step={0.1} onChange={(value) => update("shiftHours", value)} />
            <NumberField label="Horas efectivas" value={inputs.effectiveHours} unit="h" step={0.1} onChange={(value) => update("effectiveHours", value)} />
            <NumberField label="Numero de turnos" value={inputs.shifts} onChange={(value) => update("shifts", value)} />
          </section>

          <section className="form-section">
            <h2>Ruta del viaje</h2>
            <NumberField label="Distancia cargado" value={inputs.loadedDistance} unit="m" onChange={(value) => update("loadedDistance", value)} />
            <NumberField label="Distancia vacio" value={inputs.emptyDistance} unit="m" onChange={(value) => update("emptyDistance", value)} />
            <label className="field">
              <span>Tipo de recorrido</span>
              <select value={inputs.tripType} onChange={(event) => update("tripType", event.target.value as TripType)}>
                <option value="roundTrip">Ida y vuelta</option>
                <option value="simple">Simple</option>
              </select>
            </label>
            <div className="mini-route">
              <b>Origen</b>
              <div className="rail">
                <div className="moving-robot" />
              </div>
              <b>Destino</b>
            </div>
          </section>

          <section className="form-section">
            <h2>Tiempos de operacion</h2>
            <SliderField label="Recoleccion" value={inputs.pickupTime} max={180} unit="s" onChange={(value) => update("pickupTime", value)} />
            <SliderField label="Entrega" value={inputs.deliveryTime} max={180} unit="s" onChange={(value) => update("deliveryTime", value)} />
            <SliderField label="Maniobra" value={inputs.maneuverTime} max={180} unit="s" onChange={(value) => update("maneuverTime", value)} />
            <SliderField label="Espera promedio" value={inputs.waitTime} max={240} unit="s" onChange={(value) => update("waitTime", value)} />
          </section>

          <section className="form-section">
            <h2>Robot generico</h2>
            <NumberField label="Velocidad cargado" value={inputs.loadedSpeed} unit="m/s" step={0.1} onChange={(value) => update("loadedSpeed", value)} />
            <NumberField label="Velocidad vacio" value={inputs.emptySpeed} unit="m/s" step={0.1} onChange={(value) => update("emptySpeed", value)} />
            <NumberField label="Disponibilidad" value={inputs.availability} unit="%" onChange={(value) => update("availability", Math.min(100, value))} />
            <NumberField label="Autonomia bateria" value={inputs.batteryHours} unit="h" step={0.1} onChange={(value) => update("batteryHours", value)} />
            <NumberField label="Tiempo de carga" value={inputs.chargeHours} unit="h" step={0.1} onChange={(value) => update("chargeHours", value)} />
          </section>

          <section className="form-section">
            <h2>Condiciones del entorno</h2>
            <LevelChips label="Trafico operativo" value={inputs.traffic} onChange={(value) => update("traffic", value)} />
            <LevelChips label="Cruces peatonales" value={inputs.crossings} onChange={(value) => update("crossings", value)} />
            <LevelChips label="Complejidad de maniobra" value={inputs.complexity} onChange={(value) => update("complexity", value)} />
          </section>
        </form>

        <aside className="panel results-panel">
          <div className="result-card">
            <span>Robots recomendados</span>
            <strong>{results ? results.recommendedRobots : "-"}</strong>
            <small>{results ? "AMR" : "Sin calculo"}</small>
            {results && <RobotIcons count={results.recommendedRobots} hasReserve={hasReserve} />}
          </div>

          {!results && <div className="warning">Ingresa valores mayores a cero para calcular la estimacion.</div>}

          {results && status && (
            <>
              <div className="util-card">
                <div className="util-heading">
                  <span>{status.title}</span>
                  <strong>{format.format(results.utilizationPercent)}%</strong>
                </div>
                <div className={`util-bar ${status.key}`}>
                  <span style={{ width: `${Math.min(100, results.utilizationPercent)}%` }} />
                </div>
                <p>{status.message}</p>
              </div>

              <div className="route-diagram">
                <div className="station">Origen</div>
                <div className="track">
                  <span className="phase pickup">Recolecta</span>
                  <span className="phase deliver">Entrega</span>
                  <div className="animated-amr" />
                </div>
                <div className="station">Destino</div>
              </div>

              <dl className="metrics">
                <div>
                  <dt>Robots minimos calculados</dt>
                  <dd>{format2.format(results.minimumRobots)}</dd>
                </div>
                <div>
                  <dt>Tiempo de ciclo estimado</dt>
                  <dd>{format.format(results.cycleMinutes)} min</dd>
                </div>
                <div>
                  <dt>Viajes/h por robot</dt>
                  <dd>{format.format(results.tripsHourRobotReal)}</dd>
                </div>
                <div>
                  <dt>Demanda requerida/h</dt>
                  <dd>{format.format(results.tripsHourRequired)}</dd>
                </div>
                <div>
                  <dt>Capacidad instalada/h</dt>
                  <dd>{format.format(results.installedCapacityHour)}</dd>
                </div>
                <div>
                  <dt>Margen de capacidad</dt>
                  <dd>{format.format(results.capacityMargin)} viajes/h</dd>
                </div>
                <div>
                  <dt>Capacidad total por turno</dt>
                  <dd>{format.format(results.totalShiftCapacity)}</dd>
                </div>
                <div>
                  <dt>Factor de entorno</dt>
                  <dd>{format2.format(results.environmentFactor)}x</dd>
                </div>
              </dl>
            </>
          )}

          <section className="summary">
            <h2>Resumen ejecutivo</h2>
            <p>{executiveSummary}</p>
          </section>

          <p className="note">
            Estimacion preliminar sujeta a validacion de layout, trafico real, estaciones, seguridad y pruebas en sitio.
          </p>
        </aside>
      </section>
    </main>
  );
}

export type TripType = "simple" | "roundTrip";
export type DemandUnit = "shift" | "hour";

export type Destination = {
  id: string;
  name: string;
  demandUnit: DemandUnit;
  demandValue: number;
  tripType: TripType;
  loadedDistance: number;
  emptyDistance: number;
  liftsPerTrip: number;
  turnsPerTrip: number;
  bufferTime: number;
};

export type Inputs = {
  shiftHours: number;
  effectiveHours: number;
  shifts: number;
  loadedSpeed: number;
  emptySpeed: number;
  liftTime: number;
  turnTime: number;
  availability: number;
  batteryHours: number;
  chargeHours: number;
  redundancyFactor: number;
  trafficPerRobot: number;
  robotsPerCharger: number;
  destinations: Destination[];
};

export const defaultInputs: Inputs = {
  shiftHours: 8,
  effectiveHours: 7.2,
  shifts: 1,
  loadedSpeed: 0.8,
  emptySpeed: 1.2,
  liftTime: 10,
  turnTime: 4,
  availability: 90,
  batteryHours: 8,
  chargeHours: 1.5,
  redundancyFactor: 1.2,
  trafficPerRobot: 1,
  robotsPerCharger: 4,
  destinations: [{
    id: "destino-1",
    name: "Destino 1",
    demandUnit: "shift",
    demandValue: 120,
    tripType: "roundTrip",
    loadedDistance: 100,
    emptyDistance: 100,
    liftsPerTrip: 4,
    turnsPerTrip: 4,
    bufferTime: 70,
  }],
};

export const nonnegative = (value: unknown, fallback = 0) => {
  if (value === "" || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
};

const positive = (value: unknown, fallback: number) => {
  const number = nonnegative(value, fallback);
  return number > 0 ? number : fallback;
};

const routeType = (value: unknown): TripType => value === "simple" ? "simple" : "roundTrip";

export function normalizeInputs(raw: unknown): Inputs {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const routes = Array.isArray(source.destinations) ? source.destinations : null;
  const legacy = !routes && "tripsPerShift" in source;
  const legacyBuffer = nonnegative(source.pickupTime) + nonnegative(source.deliveryTime) +
    nonnegative(source.maneuverTime) + nonnegative(source.waitTime);
  const destinations: Destination[] = (routes ?? (legacy ? [source] : defaultInputs.destinations)).map((entry, index) => {
    const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const template = defaultInputs.destinations[0];
    return {
      id: `destino-${index + 1}`,
      name: typeof item.name === "string" ? item.name : `Destino ${index + 1}`,
      demandUnit: item.demandUnit === "hour" ? "hour" : "shift",
      demandValue: nonnegative(item.demandValue ?? item.tripsPerShift, template.demandValue),
      tripType: routeType(item.tripType),
      loadedDistance: nonnegative(item.loadedDistance, template.loadedDistance),
      emptyDistance: nonnegative(item.emptyDistance, template.emptyDistance),
      liftsPerTrip: nonnegative(item.liftsPerTrip, legacy ? 0 : template.liftsPerTrip),
      turnsPerTrip: nonnegative(item.turnsPerTrip, legacy ? 0 : template.turnsPerTrip),
      bufferTime: nonnegative(item.bufferTime, legacy ? legacyBuffer : template.bufferTime),
    };
  });

  return {
    shiftHours: nonnegative(source.shiftHours, defaultInputs.shiftHours),
    effectiveHours: nonnegative(source.effectiveHours, defaultInputs.effectiveHours),
    shifts: nonnegative(source.shifts, defaultInputs.shifts),
    loadedSpeed: nonnegative(source.loadedSpeed, defaultInputs.loadedSpeed),
    emptySpeed: nonnegative(source.emptySpeed, defaultInputs.emptySpeed),
    liftTime: nonnegative(source.liftTime, defaultInputs.liftTime),
    turnTime: nonnegative(source.turnTime, defaultInputs.turnTime),
    availability: Math.min(100, nonnegative(source.availability, defaultInputs.availability)),
    batteryHours: nonnegative(source.batteryHours, defaultInputs.batteryHours),
    chargeHours: nonnegative(source.chargeHours, defaultInputs.chargeHours),
    redundancyFactor: positive(source.redundancyFactor, defaultInputs.redundancyFactor),
    trafficPerRobot: nonnegative(source.trafficPerRobot, defaultInputs.trafficPerRobot),
    robotsPerCharger: positive(source.robotsPerCharger, defaultInputs.robotsPerCharger),
    destinations,
  };
}

export function validationError(inputs: Inputs): string | null {
  if (inputs.shiftHours <= 0 || inputs.effectiveHours <= 0 || inputs.effectiveHours > inputs.shiftHours) {
    return "Las horas efectivas deben ser mayores que cero y no superar la duracion del turno.";
  }
  if (!Number.isInteger(inputs.shifts) || inputs.shifts < 1) return "Indica al menos un turno completo.";
  if (inputs.shiftHours * inputs.shifts > 24) return "La duracion total de los turnos no puede superar 24 horas al dia.";
  if (inputs.loadedSpeed <= 0 || inputs.emptySpeed <= 0) return "Las velocidades deben ser mayores que cero.";
  if (inputs.availability <= 0 || inputs.batteryHours <= 0 || inputs.redundancyFactor < 1 ||
      inputs.robotsPerCharger < 1 || !Number.isInteger(inputs.robotsPerCharger)) {
    return "Revisa disponibilidad, autonomia, redundancia y robots por cargador.";
  }
  if (!inputs.destinations.length) return "Agrega al menos un destino.";
  if (inputs.destinations.some((route) =>
    route.demandValue > 0 && route.loadedDistance <= 0)) {
    return "Los destinos con demanda necesitan una distancia de ida mayor que cero.";
  }
  return null;
}

export type DestinationResult = Destination & {
  tripsPerShift: number;
  tripsHour: number;
  travelSeconds: number;
  serviceSeconds: number;
  baseCycleSeconds: number;
  cycleSeconds: number;
  rawRobots: number;
  robotsAtFleetTraffic: number;
};

export type CalculationResult = {
  destinations: DestinationResult[];
  totalTripsPerShift: number;
  totalTripsPerDay: number;
  totalTripsHour: number;
  baseRobotWorkload: number;
  trafficRobotWorkload: number;
  minimumRobots: number;
  recommendedRobots: number;
  chargeStations: number;
  batteryDutyCycle: number;
  effectiveAvailability: number;
  trafficMultiplier: number;
  requiredRobotHoursPerHour: number;
  utilizationPercent: number;
  capacityMarginRobotHours: number;
  weightedCycleSeconds: number;
  dailyRobotHours: number;
};

export function calculate(inputs: Inputs): CalculationResult | null {
  if (validationError(inputs)) return null;

  const operatingHours = inputs.effectiveHours * inputs.shifts;
  const offHours = 24 - inputs.shiftHours * inputs.shifts;
  const chargingInsideOperation = offHours >= inputs.chargeHours
    ? inputs.chargeHours * Math.max(0, Math.ceil(operatingHours / inputs.batteryHours) - 1)
    : operatingHours * inputs.chargeHours / inputs.batteryHours;
  const batteryDutyCycle = operatingHours / (operatingHours + chargingInsideOperation);
  const effectiveAvailability = (inputs.availability / 100) * batteryDutyCycle;
  const prefactor = inputs.redundancyFactor / (3600 * effectiveAvailability);
  const destinations = inputs.destinations.map((route) => {
    const tripsHour = route.demandUnit === "hour" ? route.demandValue : route.demandValue / inputs.effectiveHours;
    const tripsPerShift = tripsHour * inputs.effectiveHours;
    const returnDistance = route.tripType === "roundTrip" ? route.emptyDistance : 0;
    const travelSeconds = route.loadedDistance / inputs.loadedSpeed + returnDistance / inputs.emptySpeed;
    const serviceSeconds = route.liftsPerTrip * inputs.liftTime +
      route.turnsPerTrip * inputs.turnTime + route.bufferTime;
    const baseCycleSeconds = travelSeconds + serviceSeconds;
    return { ...route, tripsPerShift, tripsHour, travelSeconds, serviceSeconds, baseCycleSeconds };
  });
  const baseRobotWorkload = destinations.reduce(
    (sum, route) => sum + route.tripsHour * route.baseCycleSeconds * prefactor, 0,
  );
  const trafficRobotWorkload = destinations.reduce(
    (sum, route) => sum + route.tripsHour * route.travelSeconds * prefactor * inputs.trafficPerRobot / 100, 0,
  );

  // Each additional robot slows travel, so sizing must solve N >= base + traffic * (N - 1).
  if (trafficRobotWorkload >= 1 - 1e-10 && baseRobotWorkload > 1) return null;
  const minimumRobots = baseRobotWorkload <= 1 ? baseRobotWorkload :
    (baseRobotWorkload - trafficRobotWorkload) / (1 - trafficRobotWorkload);
  let recommendedRobots = baseRobotWorkload === 0 ? 0 : Math.max(1, Math.ceil(minimumRobots - 1e-10));
  while (recommendedRobots < 1_000_000 &&
    recommendedRobots + 1e-9 < baseRobotWorkload + trafficRobotWorkload * (recommendedRobots - 1)) {
    recommendedRobots += 1;
  }
  if (recommendedRobots >= 1_000_000) return null;
  const trafficMultiplier = 1 + inputs.trafficPerRobot / 100 * Math.max(0, recommendedRobots - 1);
  const destinationResults = destinations.map((route) => {
    const cycleSeconds = route.travelSeconds * trafficMultiplier + route.serviceSeconds;
    return {
      ...route,
      cycleSeconds,
      rawRobots: route.tripsHour * route.baseCycleSeconds * prefactor,
      robotsAtFleetTraffic: route.tripsHour * cycleSeconds * prefactor,
    };
  });
  const requiredRobotHoursPerHour = destinationResults.reduce(
    (sum, route) => sum + route.robotsAtFleetTraffic, 0,
  );
  const totalTripsPerShift = destinations.reduce((sum, route) => sum + route.tripsPerShift, 0);
  const totalTripsHour = totalTripsPerShift / inputs.effectiveHours;
  const weightedCycleSeconds = totalTripsHour > 0 ?
    destinationResults.reduce((sum, route) => sum + route.tripsHour * route.cycleSeconds, 0) / totalTripsHour : 0;
  const chargeStations = recommendedRobots === 0 ? 0 : Math.max(
    Math.ceil(recommendedRobots / inputs.robotsPerCharger),
    Math.ceil(recommendedRobots * (1 - batteryDutyCycle)),
    offHours > 0 && offHours >= inputs.chargeHours
      ? Math.ceil(recommendedRobots * inputs.chargeHours / offHours) : 0,
  );

  return {
    destinations: destinationResults,
    totalTripsPerShift,
    totalTripsPerDay: totalTripsPerShift * inputs.shifts,
    totalTripsHour,
    baseRobotWorkload,
    trafficRobotWorkload,
    minimumRobots,
    recommendedRobots,
    chargeStations,
    batteryDutyCycle,
    effectiveAvailability,
    trafficMultiplier,
    requiredRobotHoursPerHour,
    utilizationPercent: recommendedRobots > 0 ? requiredRobotHoursPerHour / recommendedRobots * 100 : 0,
    capacityMarginRobotHours: recommendedRobots - requiredRobotHoursPerHour,
    weightedCycleSeconds,
    dailyRobotHours: requiredRobotHoursPerHour * inputs.effectiveHours * inputs.shifts,
  };
}

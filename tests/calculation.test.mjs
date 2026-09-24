import assert from "node:assert/strict";
import test from "node:test";
import { calculate, defaultInputs, normalizeInputs, validationError } from "../src/calculation.ts";

const excelCase = (rackPerHour, distance, turns) => ({
  ...defaultInputs,
  shiftHours: 8,
  effectiveHours: 8,
  loadedSpeed: 0.5,
  emptySpeed: 0.5,
  availability: 100,
  batteryHours: 8,
  chargeHours: 0,
  redundancyFactor: 1.2,
  trafficPerRobot: 0,
  destinations: [{
    id: "route-1", name: "Ruta",
    demandUnit: "shift",
    demandValue: rackPerHour * 8,
    tripType: "roundTrip",
    loadedDistance: distance / 2,
    emptyDistance: distance / 2,
    liftsPerTrip: 4,
    turnsPerTrip: turns,
    bufferTime: 70,
  }],
});

test("reproduces the two Excel plant calculations when assumptions match", () => {
  const plant1 = calculate(excelCase(33, 240, 12));
  const plant2 = calculate(excelCase(52, 250, 6));
  assert.equal(plant1.destinations[0].cycleSeconds, 638);
  assert.equal(plant1.recommendedRobots, 8);
  assert.equal(plant1.chargeStations, 2);
  assert.ok(Math.abs(plant1.minimumRobots - 7.018) < 1e-10);
  assert.equal(plant2.destinations[0].cycleSeconds, 634);
  assert.equal(plant2.recommendedRobots, 11);
  assert.equal(plant2.chargeStations, 3);
});

test("adds destination workloads before rounding the shared fleet", () => {
  const inputs = {
    ...excelCase(1, 1440, 0),
    shiftHours: 1, effectiveHours: 1, loadedSpeed: 1, emptySpeed: 1, redundancyFactor: 1,
    destinations: [
      { ...excelCase(1, 1440, 0).destinations[0], id: "a", demandValue: 1, liftsPerTrip: 0, bufferTime: 0 },
      { ...excelCase(1, 1440, 0).destinations[0], id: "b", demandValue: 1, liftsPerTrip: 0, bufferTime: 0 },
    ],
  };
  const result = calculate(inputs);
  assert.equal(result.totalTripsHour, 2);
  assert.ok(Math.abs(result.requiredRobotHoursPerHour - 0.8) < 1e-10);
  assert.equal(result.recommendedRobots, 1);
});

test("round trip includes the return; simple trip does not", () => {
  const source = excelCase(1, 100, 0);
  const simple = {
    ...source,
    destinations: [{ ...source.destinations[0], tripType: "simple" }],
  };
  const roundTrip = {
    ...simple,
    destinations: [{ ...simple.destinations[0], tripType: "roundTrip", emptyDistance: 50 }],
  };
  assert.equal(calculate(roundTrip).destinations[0].baseCycleSeconds -
    calculate(simple).destinations[0].baseCycleSeconds, 100);
});

test("hourly demand remains fixed when the effective shift duration changes", () => {
  const base = excelCase(10, 100, 0);
  const hourly = {
    ...base,
    destinations: [{ ...base.destinations[0], demandUnit: "hour", demandValue: 10 }],
  };
  const shorter = calculate({ ...hourly, effectiveHours: 6 });
  assert.equal(shorter.destinations[0].tripsHour, 10);
  assert.equal(shorter.destinations[0].tripsPerShift, 60);
  assert.equal(shorter.totalTripsPerDay, 60);
  assert.equal(calculate(hourly).destinations[0].tripsPerShift, 80);
});

test("traffic slows travel based on the final shared fleet and can saturate it", () => {
  const base = excelCase(52, 250, 6);
  const withoutTraffic = calculate(base);
  const withTraffic = calculate({ ...base, trafficPerRobot: 2 });
  assert.ok(withTraffic.recommendedRobots > withoutTraffic.recommendedRobots);
  assert.ok(withTraffic.destinations[0].cycleSeconds > withoutTraffic.destinations[0].cycleSeconds);
  assert.ok(withTraffic.requiredRobotHoursPerHour <= withTraffic.recommendedRobots);
  assert.equal(calculate({ ...base, trafficPerRobot: 100 }), null);
  const lightRoute = excelCase(1, 100, 0);
  assert.equal(calculate({ ...lightRoute, trafficPerRobot: 1000 }).recommendedRobots, 1);
});

test("charging outside one shift leaves capacity intact; multiple shifts consume it", () => {
  const base = { ...excelCase(33, 240, 12), chargeHours: 3 };
  const oneShift = calculate(base);
  const twoShifts = calculate({ ...base, shifts: 2 });
  assert.equal(oneShift.batteryDutyCycle, 1);
  assert.ok(twoShifts.batteryDutyCycle < 1);
  assert.ok(twoShifts.minimumRobots > oneShift.minimumRobots);
  assert.ok(twoShifts.recommendedRobots > oneShift.recommendedRobots);
  assert.equal(twoShifts.totalTripsPerDay, oneShift.totalTripsPerDay * 2);
  assert.equal(validationError({ ...base, shifts: 4 }), "La duracion total de los turnos no puede superar 24 horas al dia.");
});

test("imports a legacy one-route configuration without losing its cycle times", () => {
  const legacy = normalizeInputs({
    tripsPerShift: 20, loadedDistance: 100, emptyDistance: 100,
    pickupTime: 30, deliveryTime: 30, maneuverTime: 20, waitTime: 20,
  });
  assert.equal(legacy.destinations.length, 1);
  assert.equal(legacy.destinations[0].demandUnit, "shift");
  assert.equal(legacy.destinations[0].demandValue, 20);
  assert.equal(legacy.destinations[0].bufferTime, 100);
  assert.equal(legacy.destinations[0].liftsPerTrip, 0);
  assert.equal(legacy.destinations[0].turnsPerTrip, 0);
});

test("imports hourly demand from a multi-destination configuration", () => {
  const input = normalizeInputs({
    destinations: [{ name: "Estacion A", demandUnit: "hour", demandValue: 18 }],
  });
  assert.equal(input.destinations[0].demandUnit, "hour");
  assert.equal(calculate(input).destinations[0].tripsHour, 18);
});

test("imports prior multi-destination files with trips per shift", () => {
  const input = normalizeInputs({
    effectiveHours: 8,
    destinations: [{ name: "Ruta anterior", tripsPerShift: 80 }],
  });
  assert.equal(input.destinations[0].demandUnit, "shift");
  assert.equal(input.destinations[0].demandValue, 80);
  assert.equal(calculate(input).destinations[0].tripsHour, 10);
});
